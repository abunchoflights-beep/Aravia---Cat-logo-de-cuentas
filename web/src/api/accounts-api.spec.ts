import { describe, expect, it, vi } from "vite-plus/test";
import { createAccountsApi } from "./accounts-api";
import { ApiError } from "./api-error";
import { createHttpClient, type FetchFn } from "./http-client";

const wireLeaf = {
  codigo: "110505",
  nombre: "Caja general",
  nivel: "subcuenta",
  naturaleza: "debito",
  codigoPadre: "1105",
  tieneHijas: false,
  admiteMovimientos: true,
  hijas: [],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup(fetchFn: FetchFn): ReturnType<typeof createAccountsApi> {
  return createAccountsApi(createHttpClient((path) => `http://api.test${path}`, fetchFn));
}

describe("createAccountsApi", () => {
  it("loads the tree and maps the Spanish wire format to the UI model", async () => {
    // Arrange
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(
      jsonResponse(200, [
        {
          ...wireLeaf,
          codigo: "1",
          nombre: "Activo",
          nivel: "clase",
          codigoPadre: null,
          tieneHijas: true,
          admiteMovimientos: false,
          hijas: [wireLeaf],
        },
      ]),
    );

    // Act
    const tree = await setup(fetchFn).listTree();

    // Assert
    expect(fetchFn).toHaveBeenCalledWith("http://api.test/cuentas", expect.anything());
    expect(tree).toEqual([
      {
        code: "1",
        name: "Activo",
        level: "clase",
        nature: "debito",
        parentCode: null,
        hasChildren: true,
        acceptsMovements: false,
        children: [
          {
            code: "110505",
            name: "Caja general",
            level: "subcuenta",
            nature: "debito",
            parentCode: "1105",
            hasChildren: false,
            acceptsMovements: true,
            children: [],
          },
        ],
      },
    ]);
  });

  it("posts the Spanish body and omits naturaleza when not provided", async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(jsonResponse(201, wireLeaf));

    await setup(fetchFn).create({ code: "110505", name: "Caja general" });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("http://api.test/cuentas");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ codigo: "110505", nombre: "Caja general" });
  });

  it("sends naturaleza for classes", async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValue(
        jsonResponse(201, { ...wireLeaf, codigo: "3", nivel: "clase", codigoPadre: null }),
      );

    await setup(fetchFn).create({ code: "3", name: "Patrimonio", nature: "credito" });

    expect(JSON.parse(fetchFn.mock.calls[0][1]?.body as string)).toEqual({
      codigo: "3",
      nombre: "Patrimonio",
      naturaleza: "credito",
    });
  });

  it("deletes with DELETE and accepts 204 No Content", async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(setup(fetchFn).remove("110510")).resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenCalledWith(
      "http://api.test/cuentas/110510",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("throws a typed ApiError with the server's Spanish message", async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(
      jsonResponse(409, {
        statusCode: 409,
        code: "CUENTA_CON_CUENTAS_HIJAS",
        message: 'No se puede eliminar la cuenta "1105" porque tiene cuentas hijas.',
        details: { campo: "codigo", valor: "1105" },
      }),
    );

    const error = await setup(fetchFn)
      .remove("1105")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "CUENTA_CON_CUENTAS_HIJAS" });
  });

  it("converts network failures into ERROR_RED", async () => {
    const fetchFn = vi.fn<FetchFn>().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(setup(fetchFn).listTree()).rejects.toMatchObject({ code: "ERROR_RED" });
  });

  it("rejects responses that break the contract", async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValue(jsonResponse(200, [{ ...wireLeaf, nivel: "auxiliar" }]));

    await expect(setup(fetchFn).listTree()).rejects.toMatchObject({ code: "RESPUESTA_INVALIDA" });
  });
});
