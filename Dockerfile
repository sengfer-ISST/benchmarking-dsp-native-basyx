# syntax=docker/dockerfile:1
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2025. Fraunhofer-Gesellschaft zur Foerderung der angewandten Forschung e.V. (represented by Fraunhofer ISST)

# ----------------------------------------------------------------------------
# In-container build stage (kept for reference — needs a GitHub token because
# Maven runs in an isolated container that cannot see the host's ~/.m2, so it
# must pull dataspace-protocol-lib-mongodb from GitHub Packages).
# Not used for the local build below.
# ----------------------------------------------------------------------------
# FROM maven:3.9.6-eclipse-temurin-21 AS build
# WORKDIR /app
# COPY pom.xml .
# COPY src ./src
# COPY settings.xml .
# RUN --mount=type=secret,id=github-actor,env=GITHUB_ACTOR \
#     --mount=type=secret,id=github-token,env=GITHUB_TOKEN \
#     mvn clean package -DskipTests --settings settings.xml

# Runtime Stage only — jar is built on the host (uses local ~/.m2, no token).
# Build the jar first:  mvn clean package -DskipTests
FROM eclipse-temurin:21.0.5_11-jre-alpine
WORKDIR /app
COPY target/DSP-Native-BaSyx-*.jar /app/app.jar
COPY src/main/resources/rules.json /app/rules.json
ENTRYPOINT ["java", "-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005", "-jar", "app.jar"]