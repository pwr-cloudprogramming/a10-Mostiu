# a10-mostiu/backend/Dockerfile

# Use an official Node.js runtime as a parent image
FROM node:14

# Set the working directory
WORKDIR /app

# Copy the package.json and package-lock.json (if available)
COPY ../../package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY ./src /app/src

# Expose the port the app runs on
EXPOSE 8080

# Command to run the application
CMD ["node", "src/server.js"]
