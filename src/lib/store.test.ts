import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateProjectId } from "./store.js";

describe("validateProjectId", () => {
  it("accepts simple project names", () => {
    assert.equal(validateProjectId("my-project"), true);
    assert.equal(validateProjectId("claude-remote"), true);
    assert.equal(validateProjectId("foo_bar"), true);
    assert.equal(validateProjectId("project123"), true);
  });

  it("accepts names with dots (e.g. domain names)", () => {
    assert.equal(validateProjectId("my.project"), true);
    assert.equal(validateProjectId("v1.0.0"), true);
  });

  it("accepts worktree-style names with double dashes", () => {
    assert.equal(validateProjectId("my-project--feature-branch"), true);
    assert.equal(validateProjectId("claude-remote--fix-auth"), true);
  });

  it("rejects empty string", () => {
    assert.equal(validateProjectId(""), false);
  });

  it("rejects path traversal with ..", () => {
    assert.equal(validateProjectId(".."), false);
    assert.equal(validateProjectId("../etc/passwd"), false);
    assert.equal(validateProjectId("foo/../bar"), false);
    assert.equal(validateProjectId("foo/../../etc"), false);
  });

  it("rejects forward slashes", () => {
    assert.equal(validateProjectId("foo/bar"), false);
    assert.equal(validateProjectId("/etc/passwd"), false);
    assert.equal(validateProjectId("a/b/c"), false);
  });

  it("rejects backslashes", () => {
    assert.equal(validateProjectId("foo\\bar"), false);
    assert.equal(validateProjectId("..\\..\\etc"), false);
  });

  it("rejects null bytes", () => {
    assert.equal(validateProjectId("foo\0bar"), false);
    assert.equal(validateProjectId("\0"), false);
  });
});
