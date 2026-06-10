-- Crear usuario mcp_readonly para MCP postgres
CREATE USER IF NOT EXISTS mcp_readonly WITH PASSWORD 'mcp_readonly';

-- Permisos de lectura en BD actual
GRANT CONNECT ON DATABASE cne_imbabura TO mcp_readonly;
GRANT USAGE ON SCHEMA public TO mcp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_readonly;

-- Permisos por defecto para tablas futuras
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mcp_readonly;
