import hmac
import logging
import os
from types import SimpleNamespace

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from .chain import Chain
from .config import Config
from .db import Database
from .errors import ApiError
from .indexer import Indexer

ADMIN_PREFIXES = ("/admin/", "/arbitrator/")
PUBLIC_PATHS = {"/health"}


def _eq(a, b):
    return bool(a) and hmac.compare_digest(a.encode(), (b or "").encode())


def create_app(cfg=None, chain=None, start_indexer=None):
    cfg = cfg or Config
    logging.basicConfig(level=logging.INFO)
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = cfg.MAX_UPLOAD_BYTES * 3
    CORS(app, origins=cfg.CORS_ORIGINS, allow_headers=["Content-Type", "X-API-Key", "X-Admin-Token"])
    os.makedirs(cfg.UPLOAD_DIR, exist_ok=True)

    db = Database(cfg.DB_PATH)
    chain = chain or Chain(cfg)
    indexer = Indexer(chain, db, cfg)
    app.extensions["svc"] = SimpleNamespace(cfg=cfg, db=db, chain=chain, indexer=indexer)

    @app.before_request
    def auth():
        if request.method == "OPTIONS" or request.path in PUBLIC_PATHS:
            return
        if not _eq(cfg.API_KEY, request.headers.get("X-API-Key")):
            raise ApiError("unauthorized", "Missing or invalid X-API-Key header.", 401)
        if request.path.startswith(ADMIN_PREFIXES) and not _eq(cfg.ADMIN_TOKEN, request.headers.get("X-Admin-Token")):
            raise ApiError("forbidden", "Missing or invalid X-Admin-Token header.", 403)

    @app.errorhandler(ApiError)
    def api_error(e):
        return jsonify(e.to_json()), e.http

    @app.errorhandler(404)
    def nf(_):
        return jsonify({"error": {"code": "not_found", "message": "No such route."}}), 404

    @app.errorhandler(413)
    def too_big(_):
        return jsonify({"error": {"code": "file_too_large", "message": "Upload too large."}}), 413

    @app.errorhandler(Exception)
    def unexpected(e):
        if isinstance(e, HTTPException):
            return jsonify({"error": {"code": e.name.lower().replace(" ", "_"), "message": e.description}}), e.code
        app.logger.exception("unhandled")
        return jsonify({"error": {"code": "internal", "message": "Unexpected server error."}}), 500

    from .routes import bp
    app.register_blueprint(bp)

    if (cfg.RUN_INDEXER if start_indexer is None else start_indexer) and chain.escrow:
        indexer.start()
    return app
