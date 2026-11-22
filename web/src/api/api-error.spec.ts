import { describe, expect, it } from "vite-plus/test";
import { ApiError, NETWORK_ERROR_CODE, networkError, parseApiError } from "./api-error";

describe("parseApiError", () => {
  it("maps validation details (array) to per-field messages", () => {
    // Arrange
    const body = {
      statusCode: 400,
      code: "VALIDACION_ENTRADA_FALLIDA",
      message: "Los datos enviados no son válidos.",
      details: [
        { campo: "codigo", mensaje: "El código es obligatorio." },
        { campo: "nombre", mensaje: "El nombre es obligatorio." },
        { campo: 42, mensaje: "ignorado" },
      ],
    };

    // Act
    const error = parseApiError(400, body);

    // Assert
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDACION_ENTRADA_FALLIDA");
    expect(error.message).toBe("Los datos enviados no son válidos.");
    expect(error.fieldErrors).toEqual({
      codigo: "El código es obligatorio.",
      nombre: "El nombre es obligatorio.",
    });
  });

  it("attaches the main message to the field of a domain error (object details)", () => {
    const error = parseApiError(409, {
      code: "CODIGO_CUENTA_DUPLICADO",
      message: 'Ya existe una cuenta registrada con el código "1105".',
      details: { campo: "codigo", valor: "1105" },
    });

    expect(error.fieldErrors).toEqual({
      codigo: 'Ya existe una cuenta registrada con el código "1105".',
    });
  });

  it("returns no field errors when details are absent", () => {
    const error = parseApiError(500, {
      code: "ERROR_INTERNO_SERVIDOR",
      message: "Ocurrió un error interno inesperado. Inténtalo de nuevo más tarde.",
    });

    expect(error.fieldErrors).toEqual({});
  });

  it.each([undefined, "Bad Gateway", { error: "x" }, []])(
    "falls back to a generic Spanish message for non-envelope bodies (%j)",
    (body) => {
      const error = parseApiError(502, body);

      expect(error.code).toBe("ERROR_INTERNO_SERVIDOR");
      expect(error.message).toBe(
        "Ocurrió un error inesperado (HTTP 502). Inténtalo de nuevo más tarde.",
      );
    },
  );
});

describe("networkError", () => {
  it("describes an unreachable server in Spanish (AC4.7)", () => {
    const error = networkError();

    expect(error.status).toBeNull();
    expect(error.code).toBe(NETWORK_ERROR_CODE);
    expect(error.message).toBe(
      "No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.",
    );
  });
});
