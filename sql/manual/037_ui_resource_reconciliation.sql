-- All 28 backend default resource keys already exist in the supplied snapshot.
-- Optional additive repair for a database missing one of them. Existing access rules are preserved.
BEGIN;
INSERT INTO public.ui_resource_permissions(resource_key,label,description,permissions,require_all) VALUES
 ('feature.procureToPayLifecycle','Procure-to-Pay Lifecycle','Controls access to the procure-to-pay lifecycle overview page.',ARRAY['procure-to-pay.lifecycle.view']::text[],false),
 ('feature.procureToPayReceipts','Procure-to-Pay Goods Receipts','Controls access to the procure-to-pay goods receipt entry page.',ARRAY['procure-to-pay.receipts.manage']::text[],false),
 ('feature.procureToPayInvoices','Procure-to-Pay Invoices','Controls access to the procure-to-pay invoice entry page.',ARRAY['procure-to-pay.invoices.manage']::text[],false),
 ('feature.stockItemRequests','Stock Item Request Form','Controls access to the stock item request workflow.',ARRAY['stock-requests.create']::text[],false),
 ('feature.itemRecalls','Item Recalls','Allows viewing and managing item recalls.',ARRAY['recalls.view','recalls.manage']::text[],false),
 ('feature.maintenanceWarehouseSupply','Maintenance Warehouse Supply Request','Enables access to the maintenance warehouse supply request form.',ARRAY['warehouse.manage-supply','stock-requests.create']::text[],false),
 ('feature.custody','Custody Issue & Issued Lists','Controls the custody issue and issued pages.',ARRAY['warehouse.manage-supply']::text[],false),
 ('feature.itemMaster','Item Master Data','Shows the central item master catalog (read-only).',ARRAY[]::text[],false),
 ('feature.technicalInspections','Technical Inspections','Controls access to the technical inspection log and form.',ARRAY['technical-inspections.manage']::text[],false),
 ('feature.riskManagement','Risk Management','Track and mitigate organizational risks.',ARRAY['risks.view','risks.manage']::text[],false),
 ('feature.warehouseTemplates','Warehouse Supply Templates','Allows users to manage warehouse supply templates.',ARRAY['warehouse.manage-supply']::text[],false),
 ('feature.warehouseRequests','Warehouse Supply Requests','Grants access to warehouse supply request tracking.',ARRAY['warehouse.view-supply','warehouse.manage-supply']::text[],false),
 ('feature.adminTools','Admin Tools','Controls access to the admin tools re-assignment panel.',ARRAY['approvals.reassign']::text[],false),
 ('feature.management','System Management','Shows the system management workspace.',ARRAY['users.manage','departments.manage','permissions.manage','projects.manage','roles.manage']::text[],false),
 ('feature.allRequests','All Requests','Allows viewing all purchase requests.',ARRAY['requests.view-all']::text[],false),
 ('feature.procurementPlans','Procurement Plans','Controls access to procurement plans.',ARRAY['procurement.update-status','procurement.update-cost']::text[],false),
 ('feature.contracts','Contracts Workspace','Shows the contracts management page and navigation.',ARRAY['contracts.manage']::text[],false),
 ('feature.rfxPortal','RFX Collaboration Portal','Publish RFQs/RFPs and review supplier responses.',ARRAY['rfx.manage','rfx.respond']::text[],false),
 ('feature.supplierEvaluations','Supplier Evaluations','Allows managing supplier evaluations.',ARRAY['evaluations.manage']::text[],false),
 ('feature.procurementQueues','Procurement Queues','Controls assigned and completed procurement queues.',ARRAY['procurement.update-status']::text[],false),
 ('feature.incompleteRequests','Incomplete Requests Overview','Allows viewing the incomplete request queues.',ARRAY['requests.view-incomplete']::text[],false),
 ('feature.incompleteMedical','Incomplete Medical Requests','Controls the medical incomplete queue.',ARRAY['requests.view-incomplete']::text[],false),
 ('feature.incompleteOperational','Incomplete Operational Requests','Controls the operational incomplete queue.',ARRAY['requests.view-incomplete']::text[],false),
 ('feature.auditRequests','Audit Requests','Allows access to the audit review workspace.',ARRAY['requests.view-audit']::text[],false),
 ('feature.warehouseDetail','Warehouse Supply Detail','Controls access to individual warehouse supply sheets.',ARRAY['warehouse.manage-supply','warehouse.view-supply']::text[],false),
 ('feature.dashboard','Dashboard','Controls the executive dashboard visibility.',ARRAY['dashboard.view']::text[],false),
 ('feature.analytics','Lifecycle Analytics','Controls the lifecycle analytics view.',ARRAY['dashboard.view']::text[],false),
 ('feature.dispensing','Monthly Dispensing','Controls access to monthly dispensing ingestion and analytics.',ARRAY['dashboard.view','warehouse.manage-supply']::text[],false)
ON CONFLICT(resource_key) DO NOTHING;
COMMIT;
