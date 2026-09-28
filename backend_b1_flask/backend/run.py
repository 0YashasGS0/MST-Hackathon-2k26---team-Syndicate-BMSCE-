from app import create_app
from app.config import Config

app = create_app()

if __name__ == "__main__":
    # threaded so the indexer thread and requests run together; use gunicorn -w1 for anything longer than the hackathon
    app.run(host="0.0.0.0", port=5000, threaded=True)
