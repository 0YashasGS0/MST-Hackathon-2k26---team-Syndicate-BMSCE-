// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title DealEscrow — SOW-bound stablecoin escrow with AI-proposed, party-accepted dispute resolution
/// @notice Funds are held by this contract, never by the platform wallet. The AI agent can only
///         PROPOSE a split; money moves on buyer release, mutual acceptance, timeout, or arbitrator ruling.
contract DealEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Proposed,            // buyer created deal with final SOW hash
        Accepted,            // seller accepted the same SOW hash
        Funded,              // stablecoins locked in escrow
        Delivered,           // seller marked delivery; review window running
        Disputed,            // a party raised a complaint with evidence
        ResolutionProposed,  // agent proposed a split
        Escalated,           // a party rejected the agent's split -> human arbitrator
        Released,            // full amount to seller
        Refunded,            // full amount to buyer
        Resolved,            // split paid out
        Cancelled            // cancelled before funding
    }

    struct Deal {
        address buyer;
        address seller;
        uint256 amount;
        bytes32 sowHash;        // keccak256 of the final merged SOW document (stored off-chain)
        bytes32 deliveryHash;   // hash of delivery proof
        bytes32 evidenceHash;   // hash of complaint evidence bundle
        bytes32 reasoningHash;  // hash of agent / arbitrator reasoning
        uint64 deliverBy;       // seller deadline
        uint64 reviewPeriod;    // seconds buyer has to review after delivery
        uint64 deliveredAt;
        uint16 proposedBuyerBps; // buyer refund share in basis points (0..10000)
        bool buyerAccepted;
        bool sellerAccepted;
        Status status;
    }

    uint16 public constant BPS = 10_000;

    IERC20 public immutable stablecoin;
    address public agent;       // AI resolution agent (propose-only)
    address public arbitrator;  // human resolver (final say)
    uint256 public nextDealId = 1;

    mapping(uint256 => Deal) internal deals;
    mapping(address => bool) public kycVerified;

    event KycSet(address indexed user, bool verified);
    event RolesSet(address agent, address arbitrator);
    event DealProposed(uint256 indexed id, address indexed buyer, address indexed seller, uint256 amount, bytes32 sowHash);
    event DealAccepted(uint256 indexed id, bytes32 sowHash);
    event DealCancelled(uint256 indexed id, address by);
    event DealFunded(uint256 indexed id, address indexed funder, uint256 amount);
    event DeliveryMarked(uint256 indexed id, bytes32 deliveryHash);
    event FundsReleased(uint256 indexed id, uint256 toSeller);
    event DisputeRaised(uint256 indexed id, address indexed by, bytes32 evidenceHash);
    event ResolutionProposed(uint256 indexed id, uint16 buyerBps, bytes32 reasoningHash);
    event ResolutionAccepted(uint256 indexed id, address indexed by);
    event Escalated(uint256 indexed id, address indexed by);
    event Settled(uint256 indexed id, uint256 toBuyer, uint256 toSeller, Status finalStatus);

    error NotParty();
    error NotBuyer();
    error NotSeller();
    error NotAgent();
    error NotArbitrator();
    error BadStatus(Status current);
    error KycRequired(address user);
    error InvalidParams();
    error TooEarly();

    modifier inStatus(uint256 id, Status s) {
        if (deals[id].status != s) revert BadStatus(deals[id].status);
        _;
    }

    constructor(IERC20 _stablecoin, address _agent, address _arbitrator) Ownable(msg.sender) {
        stablecoin = _stablecoin;
        agent = _agent;
        arbitrator = _arbitrator;
        emit RolesSet(_agent, _arbitrator);
    }

    function getDeal(uint256 id) external view returns (Deal memory) {
        return deals[id];
    }

    // ---------------- Admin (platform / ORG) ----------------

    function setKyc(address user, bool verified) external onlyOwner {
        kycVerified[user] = verified;
        emit KycSet(user, verified);
    }

    function setRoles(address _agent, address _arbitrator) external onlyOwner {
        agent = _agent;
        arbitrator = _arbitrator;
        emit RolesSet(_agent, _arbitrator);
    }

    // ---------------- Agreement ----------------

    function proposeDeal(address seller, uint256 amount, bytes32 sowHash, uint64 deliverBy, uint64 reviewPeriod)
        external
        returns (uint256 id)
    {
        if (!kycVerified[msg.sender]) revert KycRequired(msg.sender);
        if (!kycVerified[seller]) revert KycRequired(seller);
        if (seller == msg.sender || amount == 0 || sowHash == bytes32(0) || deliverBy <= block.timestamp) {
            revert InvalidParams();
        }
        id = nextDealId++;
        Deal storage d = deals[id];
        d.buyer = msg.sender;
        d.seller = seller;
        d.amount = amount;
        d.sowHash = sowHash;
        d.deliverBy = deliverBy;
        d.reviewPeriod = reviewPeriod;
        d.status = Status.Proposed;
        emit DealProposed(id, msg.sender, seller, amount, sowHash);
    }

    /// @notice Seller must pass the same SOW hash: proves both sides agreed to the identical document.
    function acceptDeal(uint256 id, bytes32 sowHash) external inStatus(id, Status.Proposed) {
        Deal storage d = deals[id];
        if (msg.sender != d.seller) revert NotSeller();
        if (sowHash != d.sowHash) revert InvalidParams();
        d.status = Status.Accepted;
        emit DealAccepted(id, sowHash);
    }

    function cancelDeal(uint256 id) external {
        Deal storage d = deals[id];
        if (msg.sender != d.buyer && msg.sender != d.seller) revert NotParty();
        if (d.status != Status.Proposed && d.status != Status.Accepted) revert BadStatus(d.status);
        d.status = Status.Cancelled;
        emit DealCancelled(id, msg.sender);
    }

    // ---------------- Funding ----------------

    /// @notice Buyer funds directly from their own stablecoin balance.
    function fund(uint256 id) external {
        if (msg.sender != deals[id].buyer) revert NotBuyer();
        _fund(id);
    }

    /// @notice On-ramp (ORG) funds on the buyer's behalf after receiving fiat. Refunds still go to the buyer.
    function fundFor(uint256 id) external onlyOwner {
        _fund(id);
    }

    function _fund(uint256 id) internal inStatus(id, Status.Accepted) nonReentrant {
        Deal storage d = deals[id];
        d.status = Status.Funded;
        stablecoin.safeTransferFrom(msg.sender, address(this), d.amount);
        emit DealFunded(id, msg.sender, d.amount);
    }

    // ---------------- Delivery & release ----------------

    function markDelivered(uint256 id, bytes32 deliveryHash) external inStatus(id, Status.Funded) {
        Deal storage d = deals[id];
        if (msg.sender != d.seller) revert NotSeller();
        d.deliveryHash = deliveryHash;
        d.deliveredAt = uint64(block.timestamp);
        d.status = Status.Delivered;
        emit DeliveryMarked(id, deliveryHash);
    }

    function release(uint256 id) external {
        Deal storage d = deals[id];
        if (msg.sender != d.buyer) revert NotBuyer();
        if (d.status != Status.Funded && d.status != Status.Delivered) revert BadStatus(d.status);
        _settle(id, 0, Status.Released);
    }

    /// @notice Seller gets paid if buyer stays silent past the review window.
    ///         Buyer gets refunded if seller misses the delivery deadline.
    function claimTimeout(uint256 id) external {
        Deal storage d = deals[id];
        if (d.status == Status.Delivered) {
            if (block.timestamp <= d.deliveredAt + d.reviewPeriod) revert TooEarly();
            _settle(id, 0, Status.Released);
        } else if (d.status == Status.Funded) {
            if (block.timestamp <= d.deliverBy) revert TooEarly();
            _settle(id, BPS, Status.Refunded);
        } else {
            revert BadStatus(d.status);
        }
    }

    // ---------------- Disputes ----------------

    function raiseDispute(uint256 id, bytes32 evidenceHash) external {
        Deal storage d = deals[id];
        if (msg.sender != d.buyer && msg.sender != d.seller) revert NotParty();
        if (d.status != Status.Funded && d.status != Status.Delivered) revert BadStatus(d.status);
        if (d.status == Status.Delivered && block.timestamp > d.deliveredAt + d.reviewPeriod) revert BadStatus(d.status);
        d.evidenceHash = evidenceHash;
        d.status = Status.Disputed;
        emit DisputeRaised(id, msg.sender, evidenceHash);
    }

    /// @notice Agent can only propose. It cannot move funds.
    function proposeResolution(uint256 id, uint16 buyerBps, bytes32 reasoningHash) external {
        if (msg.sender != agent) revert NotAgent();
        Deal storage d = deals[id];
        if (d.status != Status.Disputed && d.status != Status.ResolutionProposed) revert BadStatus(d.status);
        if (buyerBps > BPS) revert InvalidParams();
        d.proposedBuyerBps = buyerBps;
        d.reasoningHash = reasoningHash;
        d.buyerAccepted = false;
        d.sellerAccepted = false;
        d.status = Status.ResolutionProposed;
        emit ResolutionProposed(id, buyerBps, reasoningHash);
    }

    function acceptResolution(uint256 id) external inStatus(id, Status.ResolutionProposed) {
        Deal storage d = deals[id];
        if (msg.sender == d.buyer) d.buyerAccepted = true;
        else if (msg.sender == d.seller) d.sellerAccepted = true;
        else revert NotParty();
        emit ResolutionAccepted(id, msg.sender);
        if (d.buyerAccepted && d.sellerAccepted) _settle(id, d.proposedBuyerBps, Status.Resolved);
    }

    function escalate(uint256 id) external {
        Deal storage d = deals[id];
        if (msg.sender != d.buyer && msg.sender != d.seller) revert NotParty();
        if (d.status != Status.Disputed && d.status != Status.ResolutionProposed) revert BadStatus(d.status);
        d.status = Status.Escalated;
        emit Escalated(id, msg.sender);
    }

    function arbitrate(uint256 id, uint16 buyerBps, bytes32 reasoningHash) external inStatus(id, Status.Escalated) {
        if (msg.sender != arbitrator) revert NotArbitrator();
        if (buyerBps > BPS) revert InvalidParams();
        deals[id].reasoningHash = reasoningHash;
        _settle(id, buyerBps, Status.Resolved);
    }

    // ---------------- Internal ----------------

    function _settle(uint256 id, uint16 buyerBps, Status finalStatus) internal nonReentrant {
        Deal storage d = deals[id];
        uint256 toBuyer = (d.amount * buyerBps) / BPS;
        uint256 toSeller = d.amount - toBuyer;
        d.status = finalStatus; // effects before interactions
        if (toBuyer > 0) stablecoin.safeTransfer(d.buyer, toBuyer);
        if (toSeller > 0) stablecoin.safeTransfer(d.seller, toSeller);
        if (finalStatus == Status.Released) emit FundsReleased(id, toSeller);
        emit Settled(id, toBuyer, toSeller, finalStatus);
    }
}
