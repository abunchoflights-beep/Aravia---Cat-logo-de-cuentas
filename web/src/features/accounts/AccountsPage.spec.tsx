import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import type { AccountsApi } from "../../api/accounts-api";
import { ApiError, networkError } from "../../api/api-error";
import type { AccountNode } from "../../types/account";
import { deferred, node, sampleTree } from "../../test/account-fixtures";
import { AccountsPage } from "./AccountsPage";

interface Harness {
  readonly api: {
    listTree: ReturnType<typeof vi.fn<AccountsApi["listTree"]>>;
    create: ReturnType<typeof vi.fn<AccountsApi["create"]>>;
    remove: ReturnType<typeof vi.fn<AccountsApi["remove"]>>;
  };
  readonly user: ReturnType<typeof userEvent.setup>;
}

function renderPage(tree: ReadonlyArray<AccountNode> = sampleTree()): Harness {
  const api = {
    listTree: vi.fn<AccountsApi["listTree"]>().mockResolvedValue(tree),
    create: vi.fn<AccountsApi["create"]>(),
    remove: vi.fn<AccountsApi["remove"]>(),
  };
  const user = userEvent.setup();
  render(<AccountsPage api={api} />);
  return { api, user };
}

function duplicateError(code: string): ApiError {
  return new ApiError({
    status: 409,
    code: "CODIGO_CUENTA_DUPLICADO",
    message: `Ya existe una cuenta registrada con el código "${code}".`,
    fieldErrors: { codigo: `Ya existe una cuenta registrada con el código "${code}".` },
  });
}

describe("AccountsPage", () => {
  describe("H1 — tree", () => {
    it("shows only the classes, collapsed, once loaded (AC1.3)", async () => {
      renderPage();

      expect(await screen.findByText("Activo")).toBeTruthy();
      expect(screen.getByText("Pasivo")).toBeTruthy();
      expect(screen.queryByText("Disponible")).toBeNull();
      const toggle = screen.getByRole("button", { name: "Expandir 1 Activo" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
    });

    it("expands and collapses a branch; leaves have no toggle (AC1.4)", async () => {
      const { user } = renderPage();
      await screen.findByText("Activo");

      // Expand down to the leaves.
      await user.click(screen.getByRole("button", { name: "Expandir 1 Activo" }));
      await user.click(screen.getByRole("button", { name: "Expandir 11 Disponible" }));
      await user.click(screen.getByRole("button", { name: "Expandir 1105 Caja" }));

      expect(screen.getByText("Caja general")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Colapsar 1 Activo" }).getAttribute("aria-expanded"),
      ).toBe("true");
      expect(screen.queryByRole("button", { name: /Expandir 110505/ })).toBeNull();
      expect(screen.getAllByText("Admite movimientos")).toHaveLength(2);

      // Collapse the root.
      await user.click(screen.getByRole("button", { name: "Colapsar 1 Activo" }));
      expect(screen.queryByText("Disponible")).toBeNull();
    });

    it("expands and collapses everything (AC1.5)", async () => {
      const { user } = renderPage();
      await screen.findByText("Activo");

      await user.click(screen.getByRole("button", { name: "Expandir todo" }));
      expect(screen.getByText("Caja menor")).toBeTruthy();
      expect(screen.getByText("Bancos nacionales")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Colapsar todo" }));
      expect(screen.queryByText("Caja menor")).toBeNull();
      expect(screen.queryByText("Obligaciones financieras")).toBeNull();
    });

    it("shows an empty state for an empty catalog (AC1.6)", async () => {
      renderPage([]);

      expect(
        await screen.findByText("El catálogo está vacío. Crea una clase para empezar."),
      ).toBeTruthy();
    });
  });

  describe("H4 — loading the tree", () => {
    it("shows a loading status until the tree arrives (AC4.1)", async () => {
      const pending = deferred<ReadonlyArray<AccountNode>>();
      const api = {
        listTree: vi.fn<AccountsApi["listTree"]>().mockReturnValue(pending.promise),
        create: vi.fn<AccountsApi["create"]>(),
        remove: vi.fn<AccountsApi["remove"]>(),
      };
      render(<AccountsPage api={api} />);

      expect(screen.getByRole("status").textContent).toBe("Cargando catálogo…");
      expect(
        (screen.getByRole("button", { name: "Expandir todo" }) as HTMLButtonElement).disabled,
      ).toBe(true);

      pending.resolve(sampleTree());

      expect(await screen.findByText("Activo")).toBeTruthy();
      expect(screen.queryByText("Cargando catálogo…")).toBeNull();
    });

    it("shows the API message and retries on demand (AC4.2)", async () => {
      const api = {
        listTree: vi
          .fn<AccountsApi["listTree"]>()
          .mockRejectedValueOnce(
            new ApiError({
              status: 500,
              code: "ERROR_INTERNO_SERVIDOR",
              message: "Ocurrió un error interno inesperado. Inténtalo de nuevo más tarde.",
            }),
          )
          .mockResolvedValueOnce(sampleTree()),
        create: vi.fn<AccountsApi["create"]>(),
        remove: vi.fn<AccountsApi["remove"]>(),
      };
      const user = userEvent.setup();
      render(<AccountsPage api={api} />);

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(
        "Ocurrió un error interno inesperado. Inténtalo de nuevo más tarde.",
      );

      await user.click(within(alert).getByRole("button", { name: "Reintentar" }));

      expect(await screen.findByText("Activo")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(api.listTree).toHaveBeenCalledTimes(2);
    });

    it("explains when the server is unreachable (AC4.7)", async () => {
      const api = {
        listTree: vi.fn<AccountsApi["listTree"]>().mockRejectedValue(networkError()),
        create: vi.fn<AccountsApi["create"]>(),
        remove: vi.fn<AccountsApi["remove"]>(),
      };
      render(<AccountsPage api={api} />);

      expect((await screen.findByRole("alert")).textContent).toContain(
        "No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.",
      );
    });
  });

  describe("H2 — creating accounts", () => {
    it("creates an account, resets the form and reveals it in the tree (AC2.13, AC4.3)", async () => {
      // Arrange
      const { api, user } = renderPage();
      await screen.findByText("Activo");
      const created = node("110515", "Caja auxiliar", "debito");
      const pending = deferred<AccountNode>();
      api.create.mockReturnValue(pending.promise);
      api.listTree.mockResolvedValue(
        sampleTree([
          node("110505", "Caja general", "debito"),
          node("110510", "Caja menor", "debito"),
          created,
        ]),
      );

      // Act
      await user.type(screen.getByLabelText("Código"), "110515");
      await user.type(screen.getByLabelText("Nombre"), "Caja auxiliar");
      await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

      // Assert: submitting state
      const submitting = screen.getByRole("button", { name: "Creando…" }) as HTMLButtonElement;
      expect(submitting.closest("fieldset")?.disabled).toBe(true);
      expect(api.create).toHaveBeenCalledWith({
        code: "110515",
        name: "Caja auxiliar",
        nature: undefined,
      });

      pending.resolve(created);

      // Assert: success
      expect(await screen.findByText("Cuenta 110515 creada.")).toBeTruthy();
      expect(await screen.findByText("Caja auxiliar")).toBeTruthy();
      expect((screen.getByLabelText("Código") as HTMLInputElement).value).toBe("");
      expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("");
      expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeTruthy();
    });

    it("shows server errors next to their fields and keeps the values (AC2.11, AC4.4)", async () => {
      const { api, user } = renderPage();
      await screen.findByText("Activo");
      api.create.mockRejectedValue(
        new ApiError({
          status: 400,
          code: "VALIDACION_ENTRADA_FALLIDA",
          message: "Los datos enviados no son válidos.",
          fieldErrors: {
            codigo: "El código debe tener solo dígitos y una longitud de 1, 2, 4 o 6.",
            nombre: "El nombre es obligatorio.",
          },
        }),
      );

      await user.type(screen.getByLabelText("Código"), "123");
      await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

      const codeInput = screen.getByLabelText("Código");
      await waitFor(() => expect(codeInput.getAttribute("aria-invalid")).toBe("true"));
      const codeErrorId = codeInput.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(codeErrorId)?.textContent).toBe(
        "El código debe tener solo dígitos y una longitud de 1, 2, 4 o 6.",
      );
      const nameInput = screen.getByLabelText("Nombre");
      expect(
        document.getElementById(nameInput.getAttribute("aria-describedby") ?? "")?.textContent,
      ).toBe("El nombre es obligatorio.");
      expect((codeInput as HTMLInputElement).value).toBe("123");
      // Field errors are not duplicated as a form-level alert.
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("clears a field error when that field is edited (AC2.14)", async () => {
      const { api, user } = renderPage();
      await screen.findByText("Activo");
      api.create.mockRejectedValue(duplicateError("1105"));

      await user.type(screen.getByLabelText("Código"), "1105");
      await user.type(screen.getByLabelText("Nombre"), "Otra caja");
      await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
      expect(
        await screen.findByText('Ya existe una cuenta registrada con el código "1105".'),
      ).toBeTruthy();

      await user.type(screen.getByLabelText("Código"), "0");

      expect(
        screen.queryByText('Ya existe una cuenta registrada con el código "1105".'),
      ).toBeNull();
      expect(screen.getByLabelText("Código").getAttribute("aria-invalid")).toBe("false");
    });

    it("shows errors not tied to a field as a form-level alert", async () => {
      const { api, user } = renderPage();
      await screen.findByText("Activo");
      api.create.mockRejectedValue(networkError());

      await user.type(screen.getByLabelText("Código"), "1110");
      await user.type(screen.getByLabelText("Nombre"), "Bancos");
      await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

      expect((await screen.findByRole("alert")).textContent).toBe(
        "No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.",
      );
    });

    it("asks for the nature only for classes and shows the inherited one otherwise (AC2.12)", async () => {
      const { api, user } = renderPage();
      await screen.findByText("Activo");
      api.create.mockResolvedValue(node("3", "Patrimonio", "credito"));

      await user.type(screen.getByLabelText("Código"), "2110");
      expect(screen.queryByLabelText("Naturaleza")).toBeNull();
      expect(screen.getByText(/Heredará la naturaleza/).textContent).toBe(
        "Heredará la naturaleza Crédito de 21 Obligaciones financieras.",
      );

      await user.clear(screen.getByLabelText("Código"));
      await user.type(screen.getByLabelText("Código"), "3");
      await user.type(screen.getByLabelText("Nombre"), "Patrimonio");
      await user.selectOptions(screen.getByLabelText("Naturaleza"), "credito");
      await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

      await waitFor(() =>
        expect(api.create).toHaveBeenCalledWith({
          code: "3",
          name: "Patrimonio",
          nature: "credito",
        }),
      );
    });

    it("shows a missing class nature error next to the selector (AC2.9 in UI)", async () => {
      const { api, user } = renderPage();
      await screen.findByText("Activo");
      api.create.mockRejectedValue(
        new ApiError({
          status: 422,
          code: "NATURALEZA_CUENTA_REQUERIDA",
          message: "Las cuentas de nivel clase deben indicar su naturaleza (débito o crédito).",
          fieldErrors: {
            naturaleza:
              "Las cuentas de nivel clase deben indicar su naturaleza (débito o crédito).",
          },
        }),
      );

      await user.type(screen.getByLabelText("Código"), "3");
      await user.type(screen.getByLabelText("Nombre"), "Patrimonio");
      await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

      await waitFor(() =>
        expect(screen.getByLabelText("Naturaleza").getAttribute("aria-invalid")).toBe("true"),
      );
    });
  });

  describe("H3 — deleting accounts", () => {
    async function openCash(user: Harness["user"]): Promise<void> {
      await screen.findByText("Activo");
      await user.click(screen.getByRole("button", { name: "Expandir todo" }));
    }

    it("offers deletion only on leaves (AC3.6)", async () => {
      const { user } = renderPage();
      await openCash(user);

      expect(screen.getByRole("button", { name: "Eliminar 110510 Caja menor" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Eliminar 2105 Bancos nacionales" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Eliminar 1105 / })).toBeNull();
      expect(screen.queryByRole("button", { name: /Eliminar 1 Activo/ })).toBeNull();
    });

    it("requires confirmation and does nothing on cancel (AC3.6)", async () => {
      const { api, user } = renderPage();
      await openCash(user);

      await user.click(screen.getByRole("button", { name: "Eliminar 110510 Caja menor" }));
      expect(screen.getByText("¿Eliminar 110510?")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Cancelar" }));

      expect(api.remove).not.toHaveBeenCalled();
      expect(screen.queryByText("¿Eliminar 110510?")).toBeNull();
    });

    it("deletes after confirmation, showing progress, then refreshes (AC3.1, AC4.5)", async () => {
      const { api, user } = renderPage();
      await openCash(user);
      const pending = deferred<void>();
      api.remove.mockReturnValue(pending.promise);
      api.listTree.mockResolvedValue(sampleTree([node("110505", "Caja general", "debito")]));

      await user.click(screen.getByRole("button", { name: "Eliminar 110510 Caja menor" }));
      await user.click(screen.getByRole("button", { name: "Confirmar" }));

      const progress = screen.getByRole("button", { name: "Eliminando…" }) as HTMLButtonElement;
      expect(progress.disabled).toBe(true);
      expect(api.remove).toHaveBeenCalledWith("110510");

      pending.resolve();

      expect(await screen.findByText("Cuenta 110510 eliminada.")).toBeTruthy();
      await waitFor(() => expect(screen.queryByText("Caja menor")).toBeNull());
      expect(screen.getByText("Caja general")).toBeTruthy();
    });

    it("shows the server message and keeps the tree when deletion fails (AC4.6)", async () => {
      const { api, user } = renderPage();
      await openCash(user);
      api.remove.mockRejectedValue(
        new ApiError({
          status: 409,
          code: "CUENTA_CON_CUENTAS_HIJAS",
          message: 'No se puede eliminar la cuenta "110510" porque tiene cuentas hijas.',
        }),
      );

      await user.click(screen.getByRole("button", { name: "Eliminar 110510 Caja menor" }));
      await user.click(screen.getByRole("button", { name: "Confirmar" }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(
        'No se puede eliminar la cuenta "110510" porque tiene cuentas hijas.',
      );
      expect(screen.getByText("Caja menor")).toBeTruthy();
      expect(api.listTree).toHaveBeenCalledTimes(1);

      await user.click(within(alert).getByRole("button", { name: "Cerrar" }));
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
