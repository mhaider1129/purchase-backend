# Purchase Tracker System

A full-stack procurement, supply chain, and procure-to-pay management system designed for healthcare institutions and hospitals.

The system was developed to digitize and automate complex hospital procurement workflows including:

- Purchase requisitions
- Multi-level approval routing
- Procurement operations
- Warehouse management
- Supplier management
- Contract management
- Budget control
- Audit trail tracking
- Notifications and reminders
- Risk management
- Procure-to-pay operations

Originally designed for oncology and healthcare institutions with highly regulated procurement and operational workflows.

---

# Overview

The Purchase Tracker System is a centralized procurement and workflow management platform that supports:

- Medical procurement
- Operational procurement
- Maintenance requests
- Medical device procurement
- Inventory workflows
- Contract lifecycle management
- Supplier relationship management
- Procurement planning
- Financial workflow integration

The system is designed to support healthcare institutions with complex approval hierarchies and audit/compliance requirements.

---

# Key Features

## Procurement Management

- Stock item requests
- Non-stock item requests
- Medical device requests
- Maintenance requests
- Multi-item purchase requests
- Dynamic approval routing
- Procurement assignment workflows
- Request status tracking
- Request audit logs
- Emergency procurement support

---

## Approval Workflow Engine

- Dynamic approval chains
- Department-aware routing
- Cost-based routing
- Role-based approvals
- Auto-skip inactive approvers
- Approval delegation
- Approval history tracking
- Rejection workflows
- Audit trail logging

---

## Warehouse & Inventory Management

- Warehouse inventory tracking
- Stock requests
- Warehouse supply workflows
- Warehouse transfers
- Inventory tracking
- Item master management
- Maintenance stock management
- Inventory movement logging

---

## Supplier Management

- Supplier registration
- Supplier evaluation
- Supplier SRM workflows
- Technical inspection support
- Vendor performance tracking
- Supplier risk management

---

## Contract Management

- Contract registration
- Contract templates
- Contract clauses
- Contract evaluations
- Contract risk tracking
- Obligation tracking
- Renewal reminders

---

## Financial & Budget Features

- Budget control
- Cost tracking
- Procurement planning
- Procure-to-pay workflows
- Financial approval routing

---

## Governance & Compliance

- Full audit trail logging
- Role-based access control
- Permission management
- Notification system
- Activity tracking
- Request tracing
- Metrics and observability

---

# Technology Stack

## Frontend

- React
- Tailwind CSS
- Axios
- React Router
- Recharts
- i18next
- jsPDF
- PapaParse

---

## Backend

- Node.js
- Express.js
- PostgreSQL
- JWT Authentication
- Nodemailer

---

## Infrastructure

- Hetzner VPS
- Nginx
- PM2
- GitHub

---

## Database

- PostgreSQL
- Supabase-compatible architecture

---

# System Architecture

```text
Frontend (React + Tailwind)
            ↓
REST API (Express.js)
            ↓
Business Logic Layer
            ↓
PostgreSQL Database
            ↓
Audit + Workflow + Notification Services

# Backend Setup

Requirements
Node.js >= 20
npm >= 10
PostgreSQL

# Installation

git clone https://github.com/mhaider1129/purchase-tracker.git

cd purchase-tracker/purchase-backend

npm install

# Create Environment File

Create .env inside purchase-backend/

PORT=5000
NODE_ENV=development

DATABASE_URL=postgresql://username:password@localhost:5432/purchase_tracker

JWT_SECRET=your_jwt_secret

FRONTEND_URL=http://localhost:3000

EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=your_email
EMAIL_PASS=your_password

# Shared attachment storage (Supabase)
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_STORAGE_BUCKET=attachments
SUPABASE_STORAGE_PREFIX=attachments

# Recommended in production so uploads fail loudly instead of falling back to local disk.
ATTACHMENT_LOCAL_FALLBACK_ENABLED=false

# Run Backend

Development:

## Attachment Storage Across Devices (Important)

If attachments are visible only on the machine that uploaded them, your backend is falling back to local filesystem storage (`uploads/...`).

To make attachments downloadable from any PC/server:

1. Configure Supabase storage env vars in backend `.env`:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (recommended)
   - `SUPABASE_STORAGE_BUCKET` (for example: `attachments`)
2. Set `ATTACHMENT_LOCAL_FALLBACK_ENABLED=false` (recommended for production).
3. Restart backend after changing env vars.
4. Verify your Supabase bucket exists and the service key has permission to upload/sign URLs.

With this setup, uploaded files are stored in Supabase object storage instead of local disk, so they can be downloaded from other devices.

npm run dev

Production:

npm start

# Frontend Setup
Installation
cd ../purchase-frontend

npm install

# Create Frontend Environment File

Create .env inside purchase-frontend/

REACT_APP_API_BASE=http://localhost:5000/api

# Production Deployment
Backend Deployment (PM2)

Install PM2:

npm install -g pm2

Run backend:

pm2 start app.js --name purchase-backend

Save PM2:

pm2 save

Enable startup:

pm2 startup

# Nginx Configuration

Example Nginx reverse proxy:

server {
    server_name wici-procurement.org;

    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';

        proxy_set_header Host $host;

        proxy_cache_bypass $http_upgrade;
    }

    location / {
        root /var/www/purchase-frontend/build;
        index index.html;
        try_files $uri /index.html;
    }
}

# SSL Setup

Using Certbot:

sudo certbot --nginx \
-d wici-procurement.org \
-d www.wici-procurement.org
API Structure
Main API Groups
/api/auth
/api/requests
/api/requested-items
/api/approvals
/api/dashboard
/api/contracts
/api/suppliers
/api/projects
/api/warehouse-inventory
/api/warehouse-transfers
/api/item-master
/api/procure-to-pay
/api/budget-control
/api/notifications
/api/tasks
/api/risk-management

# Environment Variables
Backend Variables
Variable	Description
DATABASE_URL	PostgreSQL connection string
JWT_SECRET	JWT signing secret
PORT	Backend port
NODE_ENV	development or production
FRONTEND_URL	Frontend URL
EMAIL_HOST	SMTP host
EMAIL_PORT	SMTP port
EMAIL_USER	SMTP username
EMAIL_PASS	SMTP password

# Frontend Variables
Variable	Description
REACT_APP_API_BASE	Backend API URL

# Security Features

JWT authentication
Role-based access control
Permission-based authorization
Audit trail logging
CORS protection
Authentication rate limiting
Inactive user protection
Request tracing

#Observability & Monitoring

The backend includes:

Request tracing
Metrics endpoints
Error budget tracking
Audit trail middleware
Startup synchronization checks

Health endpoint:

/health

Metrics endpoint:

/metrics

# Current Modules

Completed
Authentication
Purchase Requests
Approval Engine
Audit Logs
Notifications
Warehouse Inventory
Supplier Management
Contract Management
Budget Control
Procure-to-Pay
Tasks Management
Risk Management

# Roadmap

Planned Features
Mobile application
Barcode integration
QR inventory tracking
Business intelligence dashboard
AI procurement analytics
SAP integration
OCR invoice scanning
Multi-institute centralized procurement
Advanced reporting engine
Vendor portal
E-signature support

# Developer Notes

This project was developed incrementally to replace paper-based procurement operations with a fully digital workflow platform suitable for healthcare institutions and hospitals.

The architecture prioritizes:

Auditability
Workflow flexibility
Modular procurement operations
Scalability
Compliance
Multi-department coordination

# Author

Mohammed Haider

GitHub:
https://github.com/mhaider1129