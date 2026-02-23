FROM docker.io/cloudflare/sandbox:0.7.5-python

# RUN pip3 install --no-cache-dir pandas numpy matplotlib

# Expose common workshop preview ports for local and remote preview services.
EXPOSE 8080 3000
