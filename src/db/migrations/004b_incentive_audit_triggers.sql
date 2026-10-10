-- Makes the audit log tamper-evident: rows can be added but never changed or removed.
CREATE TRIGGER IF NOT EXISTS incentive_audit_no_update BEFORE UPDATE ON incentive_audit
BEGIN SELECT RAISE(ABORT, 'incentive_audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS incentive_audit_no_delete BEFORE DELETE ON incentive_audit
BEGIN SELECT RAISE(ABORT, 'incentive_audit is append-only'); END;
