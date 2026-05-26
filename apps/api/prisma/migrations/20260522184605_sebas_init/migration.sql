-- DropIndex
DROP INDEX "idx_posiciones_ubicacion";

-- DropIndex
DROP INDEX "idx_recintos_ubicacion";

-- AlterTable
ALTER TABLE "alertas" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "asignaciones_supervisor" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "dispositivos" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "eventos_electorales" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "eventos_tracking" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "incidencia_comentarios" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "incidencias" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "kits_electorales" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "militares" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notificaciones" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "password_reset_tokens" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "recepciones_kit" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "recintos" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "refresh_tokens" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "roles" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "usuarios" ALTER COLUMN "id" DROP DEFAULT;
