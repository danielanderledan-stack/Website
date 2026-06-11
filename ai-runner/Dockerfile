FROM node:22-slim

# git for repo cloning, gh for GitHub API work inside agent jobs
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/* \
 && git config --global user.name "danielanderledan-stack" \
 && git config --global user.email "daniel.anderle.dan@gmail.com"

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY agent.js server.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
