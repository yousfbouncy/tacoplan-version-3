import test from "node:test";
import assert from "node:assert/strict";
import { isValidAccountEmail } from "../lib/account-email";

test("admite el correo de registro manual", () => {
  assert.equal(isValidAccountEmail("izlanatlas4@gmail.com"), true);
  assert.equal(isValidAccountEmail("  izlanatlas4@gmail.com  "), true);
  assert.equal(isValidAccountEmail("soporte@tacoplan.es"), true);
});
test("rechaza correos incompletos", () => {
  assert.equal(isValidAccountEmail(""), false);
  assert.equal(isValidAccountEmail("usuario@"), false);
  assert.equal(isValidAccountEmail("usuario gmail.com"), false);
});
