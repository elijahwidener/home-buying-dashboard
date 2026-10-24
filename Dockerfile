FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
# Trip planner: OpenTripPlanner 2.10 (needs Java 25), osmium to crop OpenStreetMap, unzip to read schedule dates.
COPY --from=eclipse-temurin:25-jre /opt/java/openjdk /opt/java
ADD --chmod=644 https://repo1.maven.org/maven2/org/opentripplanner/otp-shaded/2.10.0/otp-shaded-2.10.0.jar /opt/otp/otp.jar
RUN chmod 755 /opt/otp && apt-get update && apt-get install -y --no-install-recommends osmium-tool unzip && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
	PORT=3000 \
	DATA_DIR=/data \
	NODE_NO_WARNINGS=1 \
	JAVA=/opt/java/bin/java \
	OTP_JAR=/opt/otp/otp.jar
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
	CMD node -e "fetch('http://127.0.0.1:3000/manifest.webmanifest').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "build"]
