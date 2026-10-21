import { describe, expect, it } from "vitest";
import { isPreselectedImport } from "./import-offer";

const NEW = { skip: null, off: null, status: "new", hasOtherKey: false };

describe("isPreselectedImport", () => {
  it("picks new and same-vendor entries, and a name in use only when it is also another key of the same endpoint", () => {
    expect(isPreselectedImport(NEW)).toBe(true);
    expect(isPreselectedImport({ ...NEW, status: "other_key", hasOtherKey: true })).toBe(true);
    expect(isPreselectedImport({ ...NEW, status: "name_taken" })).toBe(false);
    expect(isPreselectedImport({ ...NEW, status: "name_taken", hasOtherKey: true })).toBe(true);
  });

  it("leaves out what is added, can't be read, is off in its app, or has a status it doesn't know", () => {
    expect(isPreselectedImport({ ...NEW, status: "added" })).toBe(false);
    expect(isPreselectedImport({ ...NEW, skip: "sign_in" })).toBe(false);
    expect(isPreselectedImport({ ...NEW, off: "turned_off" })).toBe(false);
    expect(isPreselectedImport({ ...NEW, status: "something_new" })).toBe(false);
  });
});
