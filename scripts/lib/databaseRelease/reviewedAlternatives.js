"use strict";
// Exact reviewed PostgreSQL catalog alternatives; no global SQL rewriting.
const pairs = [
  {
    "group": "columns",
    "expected": {
      "name": "id",
      "type": "uuid",
      "identity": "",
      "not_null": true,
      "relation": "projects",
      "generated": "",
      "default_expression": "gen_random_uuid()"
    },
    "actual": {
      "name": "id",
      "type": "uuid",
      "identity": "",
      "not_null": true,
      "relation": "projects",
      "generated": "",
      "default_expression": "pg_catalog.gen_random_uuid()"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "approval_delegation_status_ck",
      "type": "c",
      "deferred": false,
      "relation": "approval_authority_delegations",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['ACTIVE'::character varying, 'REVOKED'::character varying]::text[]))"
    },
    "actual": {
      "name": "approval_delegation_status_ck",
      "type": "c",
      "deferred": false,
      "relation": "approval_authority_delegations",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['ACTIVE'::character varying::text, 'REVOKED'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "approval_policy_rule_conditions_condition_type_check",
      "type": "c",
      "deferred": false,
      "relation": "approval_policy_rule_conditions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (condition_type::text = ANY (ARRAY['REQUEST_TYPE_EQUALS'::character varying, 'DEPARTMENT_EQUALS'::character varying, 'SECTION_EQUALS'::character varying, 'DEPARTMENT_CLASSIFICATION_EQUALS'::character varying, 'ORGANIZATION_ANCESTOR_EQUALS'::character varying, 'AMOUNT_GTE'::character varying, 'AMOUNT_LT'::character varying, 'IS_STOCK_REQUEST'::character varying, 'IS_NON_STOCK_REQUEST'::character varying, 'IS_MAINTENANCE_REQUEST'::character varying, 'IS_MEDICAL_DEVICE_REQUEST'::character varying, 'IS_MEDICAL_REQUEST'::character varying, 'WAREHOUSE_REQUIRED'::character varying]::text[]))"
    },
    "actual": {
      "name": "approval_policy_rule_conditions_condition_type_check",
      "type": "c",
      "deferred": false,
      "relation": "approval_policy_rule_conditions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (condition_type::text = ANY (ARRAY['REQUEST_TYPE_EQUALS'::character varying::text, 'DEPARTMENT_EQUALS'::character varying::text, 'SECTION_EQUALS'::character varying::text, 'DEPARTMENT_CLASSIFICATION_EQUALS'::character varying::text, 'ORGANIZATION_ANCESTOR_EQUALS'::character varying::text, 'AMOUNT_GTE'::character varying::text, 'AMOUNT_LT'::character varying::text, 'IS_STOCK_REQUEST'::character varying::text, 'IS_NON_STOCK_REQUEST'::character varying::text, 'IS_MAINTENANCE_REQUEST'::character varying::text, 'IS_MEDICAL_DEVICE_REQUEST'::character varying::text, 'IS_MEDICAL_REQUEST'::character varying::text, 'WAREHOUSE_REQUIRED'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "approval_policy_rule_steps_resolver_type_check",
      "type": "c",
      "deferred": false,
      "relation": "approval_policy_rule_steps",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (resolver_type::text = ANY (ARRAY['REQUESTER'::character varying, 'DEPARTMENT_HEAD'::character varying, 'SECTION_HEAD'::character varying, 'EXECUTIVE_OWNER'::character varying, 'POSITION'::character varying, 'CAPABILITY_HOLDER'::character varying, 'FIXED_USER'::character varying, 'FIXED_AUTHORITY'::character varying, 'SUPPLY_CHAIN_AUTHORITY'::character varying, 'COO_AUTHORITY'::character varying, 'CEO_AUTHORITY'::character varying, 'CFO_AUTHORITY'::character varying, 'WAREHOUSE_AUTHORITY'::character varying, 'MEDICAL_DEVICES_AUTHORITY'::character varying]::text[]))"
    },
    "actual": {
      "name": "approval_policy_rule_steps_resolver_type_check",
      "type": "c",
      "deferred": false,
      "relation": "approval_policy_rule_steps",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (resolver_type::text = ANY (ARRAY['REQUESTER'::character varying::text, 'DEPARTMENT_HEAD'::character varying::text, 'SECTION_HEAD'::character varying::text, 'EXECUTIVE_OWNER'::character varying::text, 'POSITION'::character varying::text, 'CAPABILITY_HOLDER'::character varying::text, 'FIXED_USER'::character varying::text, 'FIXED_AUTHORITY'::character varying::text, 'SUPPLY_CHAIN_AUTHORITY'::character varying::text, 'COO_AUTHORITY'::character varying::text, 'CEO_AUTHORITY'::character varying::text, 'CFO_AUTHORITY'::character varying::text, 'WAREHOUSE_AUTHORITY'::character varying::text, 'MEDICAL_DEVICES_AUTHORITY'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "approval_policy_shadow_differences_difference_type_check",
      "type": "c",
      "deferred": false,
      "relation": "approval_policy_shadow_differences",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (difference_type::text = ANY (ARRAY['MISSING_IN_SHADOW'::character varying, 'ADDED_BY_SHADOW'::character varying, 'DIFFERENT_USER'::character varying, 'DIFFERENT_LEVEL'::character varying, 'DIFFERENT_ORDER'::character varying, 'AMBIGUOUS_RESOLUTION'::character varying, 'UNRESOLVED_RESOLUTION'::character varying, 'DUPLICATE_PRINCIPAL'::character varying, 'MATCH'::character varying]::text[]))"
    },
    "actual": {
      "name": "approval_policy_shadow_differences_difference_type_check",
      "type": "c",
      "deferred": false,
      "relation": "approval_policy_shadow_differences",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (difference_type::text = ANY (ARRAY['MISSING_IN_SHADOW'::character varying::text, 'ADDED_BY_SHADOW'::character varying::text, 'DIFFERENT_USER'::character varying::text, 'DIFFERENT_LEVEL'::character varying::text, 'DIFFERENT_ORDER'::character varying::text, 'AMBIGUOUS_RESOLUTION'::character varying::text, 'UNRESOLVED_RESOLUTION'::character varying::text, 'DUPLICATE_PRINCIPAL'::character varying::text, 'MATCH'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "approval_policy_shadow_runs_run_status_check",
      "type": "c",
      "deferred": false,
      "relation": "approval_policy_shadow_runs",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (run_status::text = ANY (ARRAY['MATCH'::character varying, 'PARTIAL_MATCH'::character varying, 'DIFFERENT'::character varying, 'UNRESOLVED'::character varying, 'ERROR'::character varying]::text[]))"
    },
    "actual": {
      "name": "approval_policy_shadow_runs_run_status_check",
      "type": "c",
      "deferred": false,
      "relation": "approval_policy_shadow_runs",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (run_status::text = ANY (ARRAY['MATCH'::character varying::text, 'PARTIAL_MATCH'::character varying::text, 'DIFFERENT'::character varying::text, 'UNRESOLVED'::character varying::text, 'ERROR'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "approval_policy_shadow_steps_resolution_status_check",
      "type": "c",
      "deferred": false,
      "relation": "approval_policy_shadow_steps",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (resolution_status::text = ANY (ARRAY['RESOLVED'::character varying, 'DELEGATED'::character varying, 'UNRESOLVED'::character varying, 'AMBIGUOUS'::character varying, 'SKIPPED'::character varying, 'DEDUPLICATED'::character varying, 'DUPLICATE_PRINCIPAL'::character varying]::text[]))"
    },
    "actual": {
      "name": "approval_policy_shadow_steps_resolution_status_check",
      "type": "c",
      "deferred": false,
      "relation": "approval_policy_shadow_steps",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (resolution_status::text = ANY (ARRAY['RESOLVED'::character varying::text, 'DELEGATED'::character varying::text, 'UNRESOLVED'::character varying::text, 'AMBIGUOUS'::character varying::text, 'SKIPPED'::character varying::text, 'DEDUPLICATED'::character varying::text, 'DUPLICATE_PRINCIPAL'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "approval_policy_versions_status_check",
      "type": "c",
      "deferred": false,
      "relation": "approval_policy_versions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['DRAFT'::character varying, 'VALIDATED'::character varying, 'SHADOW'::character varying, 'ACTIVE'::character varying, 'RETIRED'::character varying]::text[]))"
    },
    "actual": {
      "name": "approval_policy_versions_status_check",
      "type": "c",
      "deferred": false,
      "relation": "approval_policy_versions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['DRAFT'::character varying::text, 'VALIDATED'::character varying::text, 'SHADOW'::character varying::text, 'ACTIVE'::character varying::text, 'RETIRED'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "approval_snapshot_step_resolution_ck",
      "type": "c",
      "deferred": false,
      "relation": "approval_route_snapshot_steps",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (resolution_type::text = ANY (ARRAY['RESOLVED'::character varying, 'DELEGATED'::character varying, 'UNRESOLVED'::character varying, 'AMBIGUOUS'::character varying, 'DEDUPLICATED'::character varying, 'DUPLICATE_PRINCIPAL'::character varying]::text[]))"
    },
    "actual": {
      "name": "approval_snapshot_step_resolution_ck",
      "type": "c",
      "deferred": false,
      "relation": "approval_route_snapshot_steps",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (resolution_type::text = ANY (ARRAY['RESOLVED'::character varying::text, 'DELEGATED'::character varying::text, 'UNRESOLVED'::character varying::text, 'AMBIGUOUS'::character varying::text, 'DEDUPLICATED'::character varying::text, 'DUPLICATE_PRINCIPAL'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_exceptions_exception_type_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_exceptions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (exception_type::text = ANY (ARRAY['UNAUTHORIZED_MOVEMENT'::character varying, 'UNKNOWN_TAG'::character varying, 'LOCATION_MISMATCH'::character varying, 'MISSING_ASSET'::character varying, 'DUPLICATE_SERIAL_REVIEW'::character varying, 'RFID_CONFIGURATION'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_exceptions_exception_type_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_exceptions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (exception_type::text = ANY (ARRAY['UNAUTHORIZED_MOVEMENT'::character varying::text, 'UNKNOWN_TAG'::character varying::text, 'LOCATION_MISMATCH'::character varying::text, 'MISSING_ASSET'::character varying::text, 'DUPLICATE_SERIAL_REVIEW'::character varying::text, 'RFID_CONFIGURATION'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_exceptions_severity_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_exceptions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (severity::text = ANY (ARRAY['LOW'::character varying, 'MEDIUM'::character varying, 'HIGH'::character varying, 'CRITICAL'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_exceptions_severity_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_exceptions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (severity::text = ANY (ARRAY['LOW'::character varying::text, 'MEDIUM'::character varying::text, 'HIGH'::character varying::text, 'CRITICAL'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_exceptions_status_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_exceptions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['OPEN'::character varying, 'ACKNOWLEDGED'::character varying, 'RESOLVED'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_exceptions_status_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_exceptions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['OPEN'::character varying::text, 'ACKNOWLEDGED'::character varying::text, 'RESOLVED'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_inventory_findings_severity_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_findings",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (severity::text = ANY (ARRAY['LOW'::character varying, 'MEDIUM'::character varying, 'HIGH'::character varying, 'CRITICAL'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_inventory_findings_severity_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_findings",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (severity::text = ANY (ARRAY['LOW'::character varying::text, 'MEDIUM'::character varying::text, 'HIGH'::character varying::text, 'CRITICAL'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_inventory_findings_status_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_findings",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['OPEN'::character varying, 'ACKNOWLEDGED'::character varying, 'RESOLVED'::character varying, 'DISMISSED'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_inventory_findings_status_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_findings",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['OPEN'::character varying::text, 'ACKNOWLEDGED'::character varying::text, 'RESOLVED'::character varying::text, 'DISMISSED'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_inventory_findings_type_ck",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_findings",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (finding_type::text = ANY (ARRAY['VERIFIED'::character varying, 'MISSING'::character varying, 'UNEXPECTED'::character varying, 'WRONG_LOCATION'::character varying, 'RESPONSIBILITY_MISMATCH'::character varying, 'CUSTODY_MISMATCH'::character varying, 'IDENTIFICATION_CONFLICT'::character varying, 'CONDITION_MISMATCH'::character varying, 'STATUS_MISMATCH'::character varying, 'REQUIRES_INVESTIGATION'::character varying, 'UNREGISTERED'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_inventory_findings_type_ck",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_findings",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (finding_type::text = ANY (ARRAY['VERIFIED'::character varying::text, 'MISSING'::character varying::text, 'UNEXPECTED'::character varying::text, 'WRONG_LOCATION'::character varying::text, 'RESPONSIBILITY_MISMATCH'::character varying::text, 'CUSTODY_MISMATCH'::character varying::text, 'IDENTIFICATION_CONFLICT'::character varying::text, 'CONDITION_MISMATCH'::character varying::text, 'STATUS_MISMATCH'::character varying::text, 'REQUIRES_INVESTIGATION'::character varying::text, 'UNREGISTERED'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_inventory_observations_observation_method_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_observations",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (observation_method::text = ANY (ARRAY['MANUAL'::character varying, 'QR'::character varying, 'RFID'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_inventory_observations_observation_method_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_observations",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (observation_method::text = ANY (ARRAY['MANUAL'::character varying::text, 'QR'::character varying::text, 'RFID'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_inventory_resolutions_to_status_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_resolutions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (to_status::text = ANY (ARRAY['ACKNOWLEDGED'::character varying, 'RESOLVED'::character varying, 'DISMISSED'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_inventory_resolutions_to_status_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_resolutions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (to_status::text = ANY (ARRAY['ACKNOWLEDGED'::character varying::text, 'RESOLVED'::character varying::text, 'DISMISSED'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_inventory_sessions_scope_type_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_sessions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (scope_type::text = ANY (ARRAY['LOCATION'::character varying, 'DEPARTMENT'::character varying, 'FULL_INSTITUTE'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_inventory_sessions_scope_type_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_sessions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (scope_type::text = ANY (ARRAY['LOCATION'::character varying::text, 'DEPARTMENT'::character varying::text, 'FULL_INSTITUTE'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_inventory_sessions_status_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_sessions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['DRAFT'::character varying, 'OPEN'::character varying, 'COUNTING'::character varying, 'REVIEW'::character varying, 'COMPLETED'::character varying, 'CANCELLED'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_inventory_sessions_status_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_inventory_sessions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['DRAFT'::character varying::text, 'OPEN'::character varying::text, 'COUNTING'::character varying::text, 'REVIEW'::character varying::text, 'COMPLETED'::character varying::text, 'CANCELLED'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_locations_location_type_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_locations",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (location_type::text = ANY (ARRAY['CAMPUS'::character varying, 'BUILDING'::character varying, 'FLOOR'::character varying, 'DEPARTMENT_AREA'::character varying, 'SECTION_AREA'::character varying, 'ROOM'::character varying, 'STORE'::character varying, 'WORKSHOP'::character varying, 'EXTERNAL'::character varying, 'OTHER'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_locations_location_type_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_locations",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (location_type::text = ANY (ARRAY['CAMPUS'::character varying::text, 'BUILDING'::character varying::text, 'FLOOR'::character varying::text, 'DEPARTMENT_AREA'::character varying::text, 'SECTION_AREA'::character varying::text, 'ROOM'::character varying::text, 'STORE'::character varying::text, 'WORKSHOP'::character varying::text, 'EXTERNAL'::character varying::text, 'OTHER'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_movements_movement_type_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_movements",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (movement_type::text = ANY (ARRAY['INITIAL_DEPLOYMENT'::character varying, 'PERMANENT_TRANSFER'::character varying, 'TEMPORARY_LOAN'::character varying, 'MAINTENANCE_TRANSFER'::character varying, 'EXTERNAL_MAINTENANCE'::character varying, 'RETURN'::character varying, 'STORAGE_TRANSFER'::character varying, 'DISPOSAL_TRANSFER'::character varying, 'LOCATION_CORRECTION'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_movements_movement_type_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_movements",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (movement_type::text = ANY (ARRAY['INITIAL_DEPLOYMENT'::character varying::text, 'PERMANENT_TRANSFER'::character varying::text, 'TEMPORARY_LOAN'::character varying::text, 'MAINTENANCE_TRANSFER'::character varying::text, 'EXTERNAL_MAINTENANCE'::character varying::text, 'RETURN'::character varying::text, 'STORAGE_TRANSFER'::character varying::text, 'DISPOSAL_TRANSFER'::character varying::text, 'LOCATION_CORRECTION'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_movements_status_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_movements",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['DRAFT'::character varying, 'PENDING_APPROVAL'::character varying, 'APPROVED'::character varying, 'IN_TRANSIT'::character varying, 'RECEIVED'::character varying, 'RETURNED'::character varying, 'CANCELLED'::character varying, 'REJECTED'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_movements_status_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_movements",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['DRAFT'::character varying::text, 'PENDING_APPROVAL'::character varying::text, 'APPROVED'::character varying::text, 'IN_TRANSIT'::character varying::text, 'RECEIVED'::character varying::text, 'RETURNED'::character varying::text, 'CANCELLED'::character varying::text, 'REJECTED'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "assets_acquisition_method_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (acquisition_method::text = ANY (ARRAY['PURCHASE'::character varying, 'DONATION'::character varying, 'TRANSFER_IN'::character varying, 'LEASE'::character varying, 'LOAN'::character varying, 'LEGACY'::character varying, 'OTHER'::character varying]::text[]))"
    },
    "actual": {
      "name": "assets_acquisition_method_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (acquisition_method::text = ANY (ARRAY['PURCHASE'::character varying::text, 'DONATION'::character varying::text, 'TRANSFER_IN'::character varying::text, 'LEASE'::character varying::text, 'LOAN'::character varying::text, 'LEGACY'::character varying::text, 'OTHER'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "assets_asset_class_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (asset_class::text = ANY (ARRAY['CAPITAL'::character varying, 'CONTROLLED'::character varying]::text[]))"
    },
    "actual": {
      "name": "assets_asset_class_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (asset_class::text = ANY (ARRAY['CAPITAL'::character varying::text, 'CONTROLLED'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "assets_condition_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (condition::text = ANY (ARRAY['NEW'::character varying, 'GOOD'::character varying, 'FAIR'::character varying, 'DAMAGED'::character varying, 'UNDER_REPAIR'::character varying, 'UNSERVICEABLE'::character varying, 'UNKNOWN'::character varying]::text[]))"
    },
    "actual": {
      "name": "assets_condition_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (condition::text = ANY (ARRAY['NEW'::character varying::text, 'GOOD'::character varying::text, 'FAIR'::character varying::text, 'DAMAGED'::character varying::text, 'UNDER_REPAIR'::character varying::text, 'UNSERVICEABLE'::character varying::text, 'UNKNOWN'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "assets_creation_source_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (creation_source::text = ANY (ARRAY['PROCUREMENT'::character varying, 'LEGACY_RECOVERY'::character varying, 'IMPORT'::character varying, 'MANUAL'::character varying, 'SYSTEM'::character varying]::text[]))"
    },
    "actual": {
      "name": "assets_creation_source_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (creation_source::text = ANY (ARRAY['PROCUREMENT'::character varying::text, 'LEGACY_RECOVERY'::character varying::text, 'IMPORT'::character varying::text, 'MANUAL'::character varying::text, 'SYSTEM'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "assets_operational_status_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (operational_status::text = ANY (ARRAY['IN_SERVICE'::character varying, 'IN_STORAGE'::character varying, 'UNDER_MAINTENANCE'::character varying, 'OUT_OF_SERVICE'::character varying, 'MISSING'::character varying, 'RETIRED'::character varying, 'DISPOSED'::character varying]::text[]))"
    },
    "actual": {
      "name": "assets_operational_status_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (operational_status::text = ANY (ARRAY['IN_SERVICE'::character varying::text, 'IN_STORAGE'::character varying::text, 'UNDER_MAINTENANCE'::character varying::text, 'OUT_OF_SERVICE'::character varying::text, 'MISSING'::character varying::text, 'RETIRED'::character varying::text, 'DISPOSED'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "assets_ownership_type_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (ownership_type::text = ANY (ARRAY['INSTITUTE_OWNED'::character varying, 'LEASED'::character varying, 'SUPPLIER_OWNED'::character varying, 'LOANED'::character varying, 'DONATED'::character varying, 'OTHER'::character varying]::text[]))"
    },
    "actual": {
      "name": "assets_ownership_type_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (ownership_type::text = ANY (ARRAY['INSTITUTE_OWNED'::character varying::text, 'LEASED'::character varying::text, 'SUPPLIER_OWNED'::character varying::text, 'LOANED'::character varying::text, 'DONATED'::character varying::text, 'OTHER'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "assets_reconciliation_status_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (reconciliation_status::text = ANY (ARRAY['VERIFIED'::character varying, 'UNVERIFIED'::character varying, 'MISMATCH'::character varying, 'MISSING'::character varying, 'UNKNOWN'::character varying]::text[]))"
    },
    "actual": {
      "name": "assets_reconciliation_status_check",
      "type": "c",
      "deferred": false,
      "relation": "assets",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (reconciliation_status::text = ANY (ARRAY['VERIFIED'::character varying::text, 'UNVERIFIED'::character varying::text, 'MISMATCH'::character varying::text, 'MISSING'::character varying::text, 'UNKNOWN'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_tags_tag_status_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_tags",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (tag_status::text = ANY (ARRAY['PENDING_ENCODING'::character varying, 'ACTIVE'::character varying, 'DAMAGED'::character varying, 'LOST'::character varying, 'RETIRED'::character varying, 'REPLACED'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_tags_tag_status_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_tags",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (tag_status::text = ANY (ARRAY['PENDING_ENCODING'::character varying::text, 'ACTIVE'::character varying::text, 'DAMAGED'::character varying::text, 'LOST'::character varying::text, 'RETIRED'::character varying::text, 'REPLACED'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "asset_tags_tag_type_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_tags",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (tag_type::text = ANY (ARRAY['RFID_UHF'::character varying, 'RFID_HF'::character varying, 'QR'::character varying, 'BARCODE'::character varying, 'OTHER'::character varying]::text[]))"
    },
    "actual": {
      "name": "asset_tags_tag_type_check",
      "type": "c",
      "deferred": false,
      "relation": "asset_tags",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (tag_type::text = ANY (ARRAY['RFID_UHF'::character varying::text, 'RFID_HF'::character varying::text, 'QR'::character varying::text, 'BARCODE'::character varying::text, 'OTHER'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "organization_head_reconciliation_decision_check",
      "type": "c",
      "deferred": false,
      "relation": "organization_head_reconciliation_decisions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (decision::text = ANY (ARRAY['KEEP_EXISTING'::character varying, 'MARK_LEGACY_OBSOLETE'::character varying]::text[]))"
    },
    "actual": {
      "name": "organization_head_reconciliation_decision_check",
      "type": "c",
      "deferred": false,
      "relation": "organization_head_reconciliation_decisions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (decision::text = ANY (ARRAY['KEEP_EXISTING'::character varying::text, 'MARK_LEGACY_OBSOLETE'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "organization_positions_position_type_check",
      "type": "c",
      "deferred": false,
      "relation": "organization_positions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (position_type::text = ANY (ARRAY['UNIT_HEAD'::character varying, 'EXECUTIVE_HEAD'::character varying, 'DEPARTMENT_HEAD'::character varying, 'SECTION_HEAD'::character varying, 'CUSTOM'::character varying]::text[]))"
    },
    "actual": {
      "name": "organization_positions_position_type_check",
      "type": "c",
      "deferred": false,
      "relation": "organization_positions",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (position_type::text = ANY (ARRAY['UNIT_HEAD'::character varying::text, 'EXECUTIVE_HEAD'::character varying::text, 'DEPARTMENT_HEAD'::character varying::text, 'SECTION_HEAD'::character varying::text, 'CUSTOM'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "organization_positions_unique_authority_period",
      "type": "x",
      "deferred": false,
      "relation": "organization_positions",
      "validated": true,
      "deferrable": false,
      "definition": "EXCLUDE USING gist (organization_unit_id WITH =, position_type WITH =, daterange(COALESCE(effective_from, '-infinity'::date), COALESCE(effective_to + 1, 'infinity'::date), '[)'::text) WITH &&) WHERE (is_active AND (position_type::text = ANY (ARRAY['UNIT_HEAD'::character varying, 'EXECUTIVE_HEAD'::character varying, 'DEPARTMENT_HEAD'::character varying, 'SECTION_HEAD'::character varying]::text[])))"
    },
    "actual": {
      "name": "organization_positions_unique_authority_period",
      "type": "x",
      "deferred": false,
      "relation": "organization_positions",
      "validated": true,
      "deferrable": false,
      "definition": "EXCLUDE USING gist (organization_unit_id WITH =, position_type WITH =, daterange(COALESCE(effective_from, '-infinity'::date), COALESCE(effective_to + 1, 'infinity'::date), '[)'::text) WITH &&) WHERE (is_active AND (position_type::text = ANY (ARRAY['UNIT_HEAD'::character varying::text, 'EXECUTIVE_HEAD'::character varying::text, 'DEPARTMENT_HEAD'::character varying::text, 'SECTION_HEAD'::character varying::text])))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "organization_units_unit_type_check",
      "type": "c",
      "deferred": false,
      "relation": "organization_units",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (unit_type::text = ANY (ARRAY['INSTITUTE'::character varying, 'EXECUTIVE_OFFICE'::character varying, 'DIRECTORATE'::character varying, 'DEPARTMENT'::character varying, 'SECTION'::character varying, 'UNIT'::character varying]::text[]))"
    },
    "actual": {
      "name": "organization_units_unit_type_check",
      "type": "c",
      "deferred": false,
      "relation": "organization_units",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (unit_type::text = ANY (ARRAY['INSTITUTE'::character varying::text, 'EXECUTIVE_OFFICE'::character varying::text, 'DIRECTORATE'::character varying::text, 'DEPARTMENT'::character varying::text, 'SECTION'::character varying::text, 'UNIT'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "procurement_evaluation_cases_status_chk",
      "type": "c",
      "deferred": false,
      "relation": "procurement_evaluation_cases",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['Draft'::character varying, 'In Review'::character varying, 'Finalized'::character varying, 'Cancelled'::character varying]::text[]))"
    },
    "actual": {
      "name": "procurement_evaluation_cases_status_chk",
      "type": "c",
      "deferred": false,
      "relation": "procurement_evaluation_cases",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (status::text = ANY (ARRAY['Draft'::character varying::text, 'In Review'::character varying::text, 'Finalized'::character varying::text, 'Cancelled'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "procurement_evaluation_cases_type_chk",
      "type": "c",
      "deferred": false,
      "relation": "procurement_evaluation_cases",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (evaluation_type::text = ANY (ARRAY['General'::character varying, 'Laboratory Device'::character varying, 'Medical Device'::character varying, 'IT System'::character varying, 'Service Contract'::character varying, 'Maintenance Contract'::character varying, 'Consumables'::character varying, 'Medication'::character varying, 'Capital Equipment'::character varying]::text[]))"
    },
    "actual": {
      "name": "procurement_evaluation_cases_type_chk",
      "type": "c",
      "deferred": false,
      "relation": "procurement_evaluation_cases",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (evaluation_type::text = ANY (ARRAY['General'::character varying::text, 'Laboratory Device'::character varying::text, 'Medical Device'::character varying::text, 'IT System'::character varying::text, 'Service Contract'::character varying::text, 'Maintenance Contract'::character varying::text, 'Consumables'::character varying::text, 'Medication'::character varying::text, 'Capital Equipment'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "procurement_evaluation_offers_pricing_model_chk",
      "type": "c",
      "deferred": false,
      "relation": "procurement_evaluation_offers",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (pricing_model::text = ANY (ARRAY['KIT_OWNERSHIP'::character varying, 'PAY_PER_REPORTABLE'::character varying, 'REAGENT_RENTAL'::character varying, 'HYBRID'::character varying]::text[]))"
    },
    "actual": {
      "name": "procurement_evaluation_offers_pricing_model_chk",
      "type": "c",
      "deferred": false,
      "relation": "procurement_evaluation_offers",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (pricing_model::text = ANY (ARRAY['KIT_OWNERSHIP'::character varying::text, 'PAY_PER_REPORTABLE'::character varying::text, 'REAGENT_RENTAL'::character varying::text, 'HYBRID'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "procurement_evaluation_offer_test_costs_method_chk",
      "type": "c",
      "deferred": false,
      "relation": "procurement_evaluation_offer_test_costs",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (pricing_method::text = ANY (ARRAY['KIT_OWNERSHIP'::character varying, 'PAY_PER_REPORTABLE'::character varying]::text[]))"
    },
    "actual": {
      "name": "procurement_evaluation_offer_test_costs_method_chk",
      "type": "c",
      "deferred": false,
      "relation": "procurement_evaluation_offer_test_costs",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (pricing_method::text = ANY (ARRAY['KIT_OWNERSHIP'::character varying::text, 'PAY_PER_REPORTABLE'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "procurement_item_events_overage_approval_status_check",
      "type": "c",
      "deferred": false,
      "relation": "procurement_item_events",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (overage_approval_status::text = ANY (ARRAY['not_required'::character varying, 'pending'::character varying, 'approved'::character varying, 'rejected'::character varying]::text[]))"
    },
    "actual": {
      "name": "procurement_item_events_overage_approval_status_check",
      "type": "c",
      "deferred": false,
      "relation": "procurement_item_events",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (overage_approval_status::text = ANY (ARRAY['not_required'::character varying::text, 'pending'::character varying::text, 'approved'::character varying::text, 'rejected'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "purchase_type_check",
      "type": "c",
      "deferred": false,
      "relation": "requested_items",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (purchase_type::text = ANY (ARRAY['First Time'::character varying, 'Replacement'::character varying, 'Addition'::character varying]::text[]))"
    },
    "actual": {
      "name": "purchase_type_check",
      "type": "c",
      "deferred": false,
      "relation": "requested_items",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (purchase_type::text = ANY (ARRAY['First Time'::character varying::text, 'Replacement'::character varying::text, 'Addition'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "requests_request_domain_check",
      "type": "c",
      "deferred": false,
      "relation": "requests",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (request_domain::text = ANY (ARRAY['medical'::character varying, 'operational'::character varying]::text[]))"
    },
    "actual": {
      "name": "requests_request_domain_check",
      "type": "c",
      "deferred": false,
      "relation": "requests",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (request_domain::text = ANY (ARRAY['medical'::character varying::text, 'operational'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "rfid_business_events_authorization_status_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_business_events",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (authorization_status::text = ANY (ARRAY['AUTHORIZED'::character varying, 'UNAUTHORIZED'::character varying, 'NOT_APPLICABLE'::character varying, 'UNKNOWN'::character varying]::text[]))"
    },
    "actual": {
      "name": "rfid_business_events_authorization_status_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_business_events",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (authorization_status::text = ANY (ARRAY['AUTHORIZED'::character varying::text, 'UNAUTHORIZED'::character varying::text, 'NOT_APPLICABLE'::character varying::text, 'UNKNOWN'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "rfid_business_events_direction_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_business_events",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (direction::text = ANY (ARRAY['ENTERING'::character varying, 'EXITING'::character varying, 'UNKNOWN'::character varying]::text[]))"
    },
    "actual": {
      "name": "rfid_business_events_direction_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_business_events",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (direction::text = ANY (ARRAY['ENTERING'::character varying::text, 'EXITING'::character varying::text, 'UNKNOWN'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "rfid_business_events_event_type_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_business_events",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (event_type::text = ANY (ARRAY['ASSET_SEEN'::character varying, 'LOCATION_VERIFIED'::character varying, 'PORTAL_ENTRY'::character varying, 'PORTAL_EXIT'::character varying, 'AUTHORIZED_MOVEMENT'::character varying, 'UNAUTHORIZED_MOVEMENT'::character varying, 'UNKNOWN_TAG'::character varying]::text[]))"
    },
    "actual": {
      "name": "rfid_business_events_event_type_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_business_events",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (event_type::text = ANY (ARRAY['ASSET_SEEN'::character varying::text, 'LOCATION_VERIFIED'::character varying::text, 'PORTAL_ENTRY'::character varying::text, 'PORTAL_EXIT'::character varying::text, 'AUTHORIZED_MOVEMENT'::character varying::text, 'UNAUTHORIZED_MOVEMENT'::character varying::text, 'UNKNOWN_TAG'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "rfid_portal_antennas_direction_role_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_portal_antennas",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (direction_role::text = ANY (ARRAY['SIDE_A'::character varying, 'SIDE_B'::character varying, 'APPROACH'::character varying, 'DEPARTURE'::character varying, 'UNKNOWN'::character varying]::text[]))"
    },
    "actual": {
      "name": "rfid_portal_antennas_direction_role_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_portal_antennas",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (direction_role::text = ANY (ARRAY['SIDE_A'::character varying::text, 'SIDE_B'::character varying::text, 'APPROACH'::character varying::text, 'DEPARTURE'::character varying::text, 'UNKNOWN'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "rfid_readers_reader_type_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_readers",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (reader_type::text = ANY (ARRAY['HANDHELD'::character varying, 'FIXED'::character varying]::text[]))"
    },
    "actual": {
      "name": "rfid_readers_reader_type_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_readers",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (reader_type::text = ANY (ARRAY['HANDHELD'::character varying::text, 'FIXED'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "rfid_read_events_processing_status_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_read_events",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (processing_status::text = ANY (ARRAY['PENDING'::character varying, 'PROCESSING'::character varying, 'PROCESSED'::character varying, 'FAILED'::character varying, 'IGNORED'::character varying, 'DEAD_LETTER'::character varying]::text[]))"
    },
    "actual": {
      "name": "rfid_read_events_processing_status_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_read_events",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (processing_status::text = ANY (ARRAY['PENDING'::character varying::text, 'PROCESSING'::character varying::text, 'PROCESSED'::character varying::text, 'FAILED'::character varying::text, 'IGNORED'::character varying::text, 'DEAD_LETTER'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "rfid_read_events_source_type_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_read_events",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (source_type::text = ANY (ARRAY['HANDHELD'::character varying, 'FIXED'::character varying, 'IMPORT'::character varying, 'TEST'::character varying]::text[]))"
    },
    "actual": {
      "name": "rfid_read_events_source_type_check",
      "type": "c",
      "deferred": false,
      "relation": "rfid_read_events",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (source_type::text = ANY (ARRAY['HANDHELD'::character varying::text, 'FIXED'::character varying::text, 'IMPORT'::character varying::text, 'TEST'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "supplier_principals_authorization_status_allowed_chk",
      "type": "c",
      "deferred": false,
      "relation": "supplier_principals",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (authorization_status::text = ANY (ARRAY['Pending Verification'::character varying, 'Verified'::character varying, 'Expired'::character varying, 'Rejected'::character varying, 'Suspended'::character varying]::text[]))"
    },
    "actual": {
      "name": "supplier_principals_authorization_status_allowed_chk",
      "type": "c",
      "deferred": false,
      "relation": "supplier_principals",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (authorization_status::text = ANY (ARRAY['Pending Verification'::character varying::text, 'Verified'::character varying::text, 'Expired'::character varying::text, 'Rejected'::character varying::text, 'Suspended'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "supplier_principals_relationship_type_allowed_chk",
      "type": "c",
      "deferred": false,
      "relation": "supplier_principals",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (relationship_type::text = ANY (ARRAY['Manufacturer'::character varying, 'Exclusive Agent'::character varying, 'Non-Exclusive Agent'::character varying, 'Authorized Distributor'::character varying, 'Sub-distributor'::character varying, 'Service Partner'::character varying, 'Maintenance Partner'::character varying]::text[]))"
    },
    "actual": {
      "name": "supplier_principals_relationship_type_allowed_chk",
      "type": "c",
      "deferred": false,
      "relation": "supplier_principals",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (relationship_type::text = ANY (ARRAY['Manufacturer'::character varying::text, 'Exclusive Agent'::character varying::text, 'Non-Exclusive Agent'::character varying::text, 'Authorized Distributor'::character varying::text, 'Sub-distributor'::character varying::text, 'Service Partner'::character varying::text, 'Maintenance Partner'::character varying::text]))"
    }
  },
  {
    "group": "constraints",
    "expected": {
      "name": "suppliers_regulatory_risk_level_allowed_chk",
      "type": "c",
      "deferred": false,
      "relation": "suppliers",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (regulatory_risk_level::text = ANY (ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying]::text[]))"
    },
    "actual": {
      "name": "suppliers_regulatory_risk_level_allowed_chk",
      "type": "c",
      "deferred": false,
      "relation": "suppliers",
      "validated": true,
      "deferrable": false,
      "definition": "CHECK (regulatory_risk_level::text = ANY (ARRAY['low'::character varying::text, 'medium'::character varying::text, 'high'::character varying::text, 'critical'::character varying::text]))"
    }
  },
  {
    "group": "indexes",
    "expected": {
      "name": "asset_inventory_one_open_finding_uq",
      "ready": true,
      "valid": true,
      "relation": "asset_inventory_findings",
      "immediate": true,
      "definition": "CREATE UNIQUE INDEX asset_inventory_one_open_finding_uq ON asset_inventory_findings USING btree (session_id, finding_type, COALESCE(asset_id, 0::bigint), COALESCE(discovery_id, 0::bigint)) WHERE status::text = ANY (ARRAY['OPEN'::character varying, 'ACKNOWLEDGED'::character varying]::text[])",
      "unique_index": true,
      "primary_index": false,
      "nulls_not_distinct": false
    },
    "actual": {
      "name": "asset_inventory_one_open_finding_uq",
      "ready": true,
      "valid": true,
      "relation": "asset_inventory_findings",
      "immediate": true,
      "definition": "CREATE UNIQUE INDEX asset_inventory_one_open_finding_uq ON asset_inventory_findings USING btree (session_id, finding_type, COALESCE(asset_id, 0::bigint), COALESCE(discovery_id, 0::bigint)) WHERE status::text = ANY (ARRAY['OPEN'::character varying::text, 'ACKNOWLEDGED'::character varying::text])",
      "unique_index": true,
      "primary_index": false,
      "nulls_not_distinct": false
    }
  },
  {
    "group": "indexes",
    "expected": {
      "name": "asset_movements_one_active_uq",
      "ready": true,
      "valid": true,
      "relation": "asset_movements",
      "immediate": true,
      "definition": "CREATE UNIQUE INDEX asset_movements_one_active_uq ON asset_movements USING btree (institute_id, asset_id) WHERE status::text = ANY (ARRAY['PENDING_APPROVAL'::character varying, 'APPROVED'::character varying, 'IN_TRANSIT'::character varying]::text[])",
      "unique_index": true,
      "primary_index": false,
      "nulls_not_distinct": false
    },
    "actual": {
      "name": "asset_movements_one_active_uq",
      "ready": true,
      "valid": true,
      "relation": "asset_movements",
      "immediate": true,
      "definition": "CREATE UNIQUE INDEX asset_movements_one_active_uq ON asset_movements USING btree (institute_id, asset_id) WHERE status::text = ANY (ARRAY['PENDING_APPROVAL'::character varying::text, 'APPROVED'::character varying::text, 'IN_TRANSIT'::character varying::text])",
      "unique_index": true,
      "primary_index": false,
      "nulls_not_distinct": false
    }
  },
  {
    "group": "indexes",
    "expected": {
      "name": "idx_approvals_approver_decision_date",
      "ready": true,
      "valid": true,
      "relation": "approvals",
      "immediate": true,
      "definition": "CREATE INDEX idx_approvals_approver_decision_date ON approvals USING btree (approver_id, status, approved_at DESC) WHERE status::text = ANY (ARRAY['Approved'::character varying, 'Rejected'::character varying]::text[])",
      "unique_index": false,
      "primary_index": false,
      "nulls_not_distinct": false
    },
    "actual": {
      "name": "idx_approvals_approver_decision_date",
      "ready": true,
      "valid": true,
      "relation": "approvals",
      "immediate": true,
      "definition": "CREATE INDEX idx_approvals_approver_decision_date ON approvals USING btree (approver_id, status, approved_at DESC) WHERE status::text = ANY (ARRAY['Approved'::character varying::text, 'Rejected'::character varying::text])",
      "unique_index": false,
      "primary_index": false,
      "nulls_not_distinct": false
    }
  },
  {
    "group": "indexes",
    "expected": {
      "name": "idx_requested_items_approval_history",
      "ready": true,
      "valid": true,
      "relation": "requested_items",
      "immediate": true,
      "definition": "CREATE INDEX idx_requested_items_approval_history ON requested_items USING btree (request_id, approved_by, approval_status, approved_at DESC) WHERE approval_status::text = ANY (ARRAY['Approved'::character varying, 'Rejected'::character varying]::text[])",
      "unique_index": false,
      "primary_index": false,
      "nulls_not_distinct": false
    },
    "actual": {
      "name": "idx_requested_items_approval_history",
      "ready": true,
      "valid": true,
      "relation": "requested_items",
      "immediate": true,
      "definition": "CREATE INDEX idx_requested_items_approval_history ON requested_items USING btree (request_id, approved_by, approval_status, approved_at DESC) WHERE approval_status::text = ANY (ARRAY['Approved'::character varying::text, 'Rejected'::character varying::text])",
      "unique_index": false,
      "primary_index": false,
      "nulls_not_distinct": false
    }
  },
  {
    "group": "indexes",
    "expected": {
      "name": "organization_positions_unique_authority_period",
      "ready": true,
      "valid": true,
      "relation": "organization_positions",
      "immediate": true,
      "definition": "CREATE INDEX organization_positions_unique_authority_period ON organization_positions USING gist (organization_unit_id, position_type, daterange(COALESCE(effective_from, '-infinity'::date), COALESCE(effective_to + 1, 'infinity'::date), '[)'::text)) WHERE is_active AND (position_type::text = ANY (ARRAY['UNIT_HEAD'::character varying, 'EXECUTIVE_HEAD'::character varying, 'DEPARTMENT_HEAD'::character varying, 'SECTION_HEAD'::character varying]::text[]))",
      "unique_index": false,
      "primary_index": false,
      "nulls_not_distinct": false
    },
    "actual": {
      "name": "organization_positions_unique_authority_period",
      "ready": true,
      "valid": true,
      "relation": "organization_positions",
      "immediate": true,
      "definition": "CREATE INDEX organization_positions_unique_authority_period ON organization_positions USING gist (organization_unit_id, position_type, daterange(COALESCE(effective_from, '-infinity'::date), COALESCE(effective_to + 1, 'infinity'::date), '[)'::text)) WHERE is_active AND (position_type::text = ANY (ARRAY['UNIT_HEAD'::character varying::text, 'EXECUTIVE_HEAD'::character varying::text, 'DEPARTMENT_HEAD'::character varying::text, 'SECTION_HEAD'::character varying::text]))",
      "unique_index": false,
      "primary_index": false,
      "nulls_not_distinct": false
    }
  },
  {
    "group": "indexes",
    "expected": {
      "name": "organization_positions_unique_authority_uq",
      "ready": true,
      "valid": true,
      "relation": "organization_positions",
      "immediate": true,
      "definition": "CREATE UNIQUE INDEX organization_positions_unique_authority_uq ON organization_positions USING btree (organization_unit_id, position_type) WHERE is_active AND (position_type::text = ANY (ARRAY['UNIT_HEAD'::character varying, 'EXECUTIVE_HEAD'::character varying, 'DEPARTMENT_HEAD'::character varying, 'SECTION_HEAD'::character varying]::text[]))",
      "unique_index": true,
      "primary_index": false,
      "nulls_not_distinct": false
    },
    "actual": {
      "name": "organization_positions_unique_authority_uq",
      "ready": true,
      "valid": true,
      "relation": "organization_positions",
      "immediate": true,
      "definition": "CREATE UNIQUE INDEX organization_positions_unique_authority_uq ON organization_positions USING btree (organization_unit_id, position_type) WHERE is_active AND (position_type::text = ANY (ARRAY['UNIT_HEAD'::character varying::text, 'EXECUTIVE_HEAD'::character varying::text, 'DEPARTMENT_HEAD'::character varying::text, 'SECTION_HEAD'::character varying::text]))",
      "unique_index": true,
      "primary_index": false,
      "nulls_not_distinct": false
    }
  },
  {
    "group": "indexes",
    "expected": {
      "name": "rfid_processing_due_idx",
      "ready": true,
      "valid": true,
      "relation": "rfid_read_events",
      "immediate": true,
      "definition": "CREATE INDEX rfid_processing_due_idx ON rfid_read_events USING btree (processing_next_attempt_at, read_timestamp, id) WHERE processing_status::text = ANY (ARRAY['PENDING'::character varying, 'FAILED'::character varying]::text[])",
      "unique_index": false,
      "primary_index": false,
      "nulls_not_distinct": false
    },
    "actual": {
      "name": "rfid_processing_due_idx",
      "ready": true,
      "valid": true,
      "relation": "rfid_read_events",
      "immediate": true,
      "definition": "CREATE INDEX rfid_processing_due_idx ON rfid_read_events USING btree (processing_next_attempt_at, read_timestamp, id) WHERE processing_status::text = ANY (ARRAY['PENDING'::character varying::text, 'FAILED'::character varying::text])",
      "unique_index": false,
      "primary_index": false,
      "nulls_not_distinct": false
    }
  }
];
const equal = (a,b) => require("node:util").isDeepStrictEqual(a,b);
// Check the bound function, not the search-path-dependent printed expression.
const uuidIdentitySql = `SELECT EXISTS (
 SELECT 1 FROM pg_catalog.pg_attrdef d
 JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
 JOIN pg_catalog.pg_proc p ON p.oid::text=substring(d.adbin::text from '^\\{FUNCEXPR :funcid ([0-9]+) ')
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE d.adrelid=pg_catalog.to_regclass('public.projects') AND a.attname='id'
 AND p.proname='gen_random_uuid' AND p.pronargs=0 AND p.prorettype='pg_catalog.uuid'::regtype
 AND NOT p.prosecdef AND NOT p.proretset
 AND ((n.nspname='pg_catalog' AND l.lanname='internal' AND p.prosrc='gen_random_uuid')
 OR (n.nspname='extensions' AND l.lanname='c' AND p.prosrc='pg_random_uuid' AND p.probin='$libdir/pgcrypto'
 AND EXISTS (SELECT 1 FROM pg_catalog.pg_depend dep JOIN pg_catalog.pg_extension e ON e.oid=dep.refobjid
 WHERE dep.classid='pg_catalog.pg_proc'::regclass AND dep.objid=p.oid AND dep.refclassid='pg_catalog.pg_extension'::regclass AND dep.deptype='e' AND e.extname='pgcrypto')))
) AS valid`;
function matches(group, expected, actual, {profile=null, uuidVerified=false}={}) {
  if (profile !== 'wici-2026-11' || (group === 'columns' && !uuidVerified)) return false;
  return pairs.some(p => p.group === group && equal(p.expected,expected) && equal(p.actual,actual));
}
module.exports = { pairs, matches, uuidIdentitySql };
