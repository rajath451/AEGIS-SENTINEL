# Use a slim Python 3.10 image for clean, high-performance container builds
FROM python:3.10-slim

# Set work directory
WORKDIR /app

# Set environmental variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=7860

# Install basic system tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy and install dependencies first (to leverage Docker caching layers)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all project source code and static assets into the image
COPY . .

# Expose port (7860 is Hugging Face standard, Render reads env.PORT)
EXPOSE 7860

# Run the web server
CMD ["python", "web_server.py"]
