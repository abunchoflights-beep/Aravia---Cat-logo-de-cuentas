import { describe, expect, it } from "vite-plus/test";
import { node } from "../../test/account-fixtures";
import { ancestorCodes, branchCodes, findNode, parentCodeOf } from "./account-tree.utils";

describe("account tree utils", () => {
  const tree = [
    node("1", "Activo", "debito", [
      node("11", "Disponible", "debito", [node("1105", "Caja", "debito")]),
    ]),
    node("2", "Pasivo", "credito"),
  ];

  it("finds nodes at any depth", () => {
    expect(findNode(tree, "1105")?.name).toBe("Caja");
    expect(findNode(tree, "9")).toBeUndefined();
  });

  it.each([
    ["110515", ["1", "11", "1105"]],
    ["1105", ["1", "11"]],
    ["11", ["1"]],
    ["1", []],
    ["123", []],
    ["11a5", []],
    ["", []],
  ])("derives the ancestors of %j", (code, expected) => {
    expect(ancestorCodes(code)).toEqual(expected);
  });

  it("derives the parent code, or null for classes and invalid codes", () => {
    expect(parentCodeOf("110515")).toBe("1105");
    expect(parentCodeOf("1")).toBeNull();
    expect(parentCodeOf("123")).toBeNull();
  });

  it("collects only branch codes", () => {
    expect(branchCodes(tree)).toEqual(["1", "11"]);
  });
});
