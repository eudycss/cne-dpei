import { ForbiddenException } from "@nestjs/common";

import { AsistenciaCdaController } from "./asistencia-cda.controller";
import type { AsistenciaCdaService } from "./asistencia-cda.service";
import type { AuthenticatedUser } from "../common/current-user.decorator";

const OP = "11111111-2222-4333-8444-555555555555";
const SUPERVISOR: AuthenticatedUser = {
  sub: "u1",
  email: null,
  roles: ["TECNICO_SUPERVISOR"],
  debeCambiarPwd: false,
};

/** Cada endpoint que escribe pasa primero por la regla del supervisor: si la quitan, falla aquí. */
describe("AsistenciaCdaController: el supervisor no se registra a sí mismo", () => {
  const asistencia = {
    asegurarNoPropio: jest.fn(),
    operadorPropioId: jest.fn(),
    marcar: jest.fn(),
    corregir: jest.fn(),
    deshacer: jest.fn(),
    marcarMasiva: jest.fn(),
    dia: jest.fn(),
  };
  const controller = new AsistenciaCdaController(
    asistencia as unknown as AsistenciaCdaService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    asistencia.asegurarNoPropio.mockRejectedValue(
      new ForbiddenException("propia"),
    );
  });

  it.each([
    [
      "marcar",
      () => controller.marcar(SUPERVISOR, OP, { tipo: "ENTRADA" }),
      "marcar",
    ],
    [
      "corregir",
      () =>
        controller.corregir(SUPERVISOR, OP, "2026-11-10", {
          entrada: "08:00",
          salida: null,
          motivo: "x",
        } as never),
      "corregir",
    ],
    [
      "deshacer",
      () => controller.deshacer(SUPERVISOR, OP, "ENTRADA"),
      "deshacer",
    ],
  ] as const)("%s: 403 sin escribir nada", async (_n, llamar, metodo) => {
    await expect(llamar()).rejects.toThrow(ForbiddenException);
    expect(asistencia.asegurarNoPropio).toHaveBeenCalledWith(SUPERVISOR, OP);
    expect(asistencia[metodo]).not.toHaveBeenCalled();
  });

  it("masiva: excluye la fila propia del supervisor", async () => {
    asistencia.operadorPropioId.mockResolvedValue(OP);
    await controller.masiva(SUPERVISOR, {
      tipo: "ENTRADA",
      operadorIds: [OP, "o2"],
    });
    expect(asistencia.marcarMasiva).toHaveBeenCalledWith(
      "ENTRADA",
      [OP, "o2"],
      "u1",
      OP,
    );
  });

  it("el día se consulta con quien pregunta (para marcar su fila como solo consulta)", () => {
    controller.dia(SUPERVISOR, "2026-11-10", "OPERADOR");
    expect(asistencia.dia).toHaveBeenCalledWith(
      "2026-11-10",
      "OPERADOR",
      SUPERVISOR,
    );
  });
});
