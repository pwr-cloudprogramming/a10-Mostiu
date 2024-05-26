# AWS PROVIDER
provider "aws" {
  region                   = "us-east-1"
  shared_credentials_files = ["C:/Users/tomas/.aws/credentials.txt"]
}

# SET UP VPC
resource "aws_vpc" "my_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "my_vpc"
  }
}

# CREATE SUBNETS
resource "aws_subnet" "public_subnet" {
  vpc_id                  = aws_vpc.my_vpc.id
  cidr_block              = "10.0.101.0/24"
  map_public_ip_on_launch = true
  availability_zone       = "us-east-1a"
  tags = {
    Name = "public_subnet"
  }
}

resource "aws_subnet" "private_subnet" {
  vpc_id            = aws_vpc.my_vpc.id
  cidr_block        = "10.0.102.0/24"
  availability_zone = "us-east-1b"
  tags = {
    Name = "private_subnet"
  }
}

# CREATE INTERNET GATEWAY
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.my_vpc.id

  tags = {
    name = "my_igw"
  }
}

# CREATE ROUTE TABLES
resource "aws_route_table" "public_route_table" {
  vpc_id = aws_vpc.my_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = {
    Name = "public_route_table"
  }
}

# ASSOCIATE ROUTE TABLE WITH PUBLIC SUBNET
resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public_subnet.id
  route_table_id = aws_route_table.public_route_table.id
}

# CONFIGURE SECURITY GROUPS
resource "aws_security_group" "server_sg" {
  name        = "server_security"
  description = "allow ssh, http, and websocket traffic"
  vpc_id      = aws_vpc.my_vpc.id

  ingress {
    description = "HTTP Frontend"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTP Backend"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "server_sg"
  }
}

# DEPLOY EC2 INSTANCE
resource "aws_instance" "server" {
  ami                         = "ami-080e1f13689e07408"  
  instance_type               = "t2.micro"
  key_name                    = "vockey"
  subnet_id                   = aws_subnet.public_subnet.id
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.server_sg.id]

  user_data = <<-EOF
#!/bin/bash
  set -e  # Stop script execution on any error

  # Update system and install necessary packages
  sudo apt-get update
  sudo apt-get install -y nodejs npm nginx

  # Clone the repository
  git clone https://your-github-repository-url /home/ubuntu/tictactoe

  # Backend setup
  cd /home/ubuntu/tictactoe/backend/src
  npm install
  nohup node server.js > /dev/null 2>&1 &

  # Frontend setup
  sudo cp -r /home/ubuntu/tictactoe/frontend/src/* /var/www/html/

  # Configure Nginx to serve the frontend files
  echo "server {
      listen 80;
      server_name _;
      root /var/www/html;
      index index.html index.htm;

      location / {
          try_files \$uri \$uri/ =404;
      }

      location /api/ {
          proxy_pass http://localhost:8080/;
          proxy_http_version 1.1;
          proxy_set_header Upgrade \$http_upgrade;
          proxy_set_header Connection 'upgrade';
          proxy_set_header Host \$host;
          proxy_cache_bypass \$http_upgrade;
      }
  }" | sudo tee /etc/nginx/sites-available/default

  sudo ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/
  sudo systemctl restart nginx
  sudo systemctl enable nginx

EOF

  tags = {
    Name = "TicTacToeServer"
  }
}

# OUTPUT IP ADDRESSES
output "server_public_ip" {
  value = aws_instance.server.public_ip
}