-- 0033 created billing.retention_exports and its RLS policies but not the
-- table privileges the API role needs. Grant them (RLS still narrows which
-- rows each actor sees).

grant select, insert on billing.retention_exports to identity_api;
