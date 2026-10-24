# Backend Architecture Context: TuitionDesk

## Overview
TuitionDesk uses Next.js App Router for Serverless API routes (`src/app/api/...`). The database is MongoDB, and we will use Mongoose as the ORM. The architecture is a Multi-Tenant SaaS, meaning every database record MUST include a `centerId` to isolate data between different tuition centers.

## Tech Stack
- **API Framework:** Next.js Serverless API Routes (App Router format)
- **Database:** MongoDB Atlas
- **ORM:** Mongoose
- **Language:** TypeScript

## Core Database Models (Mongoose Schemas to be created in `src/models/`)
1. **Center (Institute):**
   - Fields: `centerId` (String, unique), `name` (String), `ownerName` (String), `phone` (String), `themeColor` (String), `isActive` (Boolean).
2. **Student:**
   - Fields: `centerId` (String, ref), `name` (String), `batch` (String), `parentWhatsApp` (String), `isActive` (Boolean).
3. **Attendance:**
   - Fields: `centerId` (String, ref), `studentId` (ObjectId, ref), `date` (Date), `batch` (String), `status` (Enum: 'Present', 'Absent').
4. **Fee:**
   - Fields: `centerId` (String, ref), `studentId` (ObjectId, ref), `month` (String), `amountDue` (Number), `dueDate` (Date), `status` (Enum: 'Pending', 'Paid').

## Backend Development Rules
1. **Folder Structure:** 
   - Database connection logic goes in `src/lib/db.ts`.
   - Mongoose models go in `src/models/`.
   - API routes go in `src/app/api/[route]/route.ts`.
2. **Multi-Tenancy Enforcement:** Every API request must eventually validate the `centerId` (for now, we will pass `centerId` in headers or body until auth is fully implemented). Never return data without filtering by `centerId`.
3. **Response Format:** All API responses must return standard JSON formats: `{ success: true, data: ... }` or `{ success: false, error: "message" }`.
4. **Error Handling:** Wrap all database calls in `try...catch` blocks. Do not crash the server on DB failures.