process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
// Controller/unit fixtures assume a deployed schema. Real contract, permission,
// RLS and DDL-denied behavior are exercised by the disposable PostgreSQL suite.
// This mocks neither business authorization nor the release/startup gate.
jest.mock('../utils/runtimeSchemaContract',()=>({assertModuleContract:jest.fn().mockResolvedValue(true),markReleaseVerified:jest.fn(),registerClient:jest.fn()}));
