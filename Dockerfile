# Use a slim Python 3.10 image for clean, high-performance container builds
FROM python:3.10-slim

# Set environmental variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=7860 \
    HOME=/home/user

# Install basic system tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create a user with UID 1000 and home directory
RUN useradd -m -u 1000 user

# Set work directory
WORKDIR $HOME/app

# Set PATH so user-installed binaries can be resolved
ENV PATH=$HOME/.local/bin:$PATH

# Copy and install dependencies first (to leverage Docker caching layers)
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Copy all project source code and static assets into the image
COPY --chown=user . .

# Switch to the non-root user
USER user

# Expose port (7860 is Hugging Face standard, Render reads env.PORT)
EXPOSE 7860

# Run the web server
CMD ["python", "web_server.py"]
