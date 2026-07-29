jest.mock("@/logger");

// miyoUtils (real) pulls these at module load; stub so importing here is inert.
jest.mock("@/plusUtils", () => ({ isSelfHostModeValidFor: jest.fn() }));
jest.mock("@/miyo/miyoStatusStore", () => ({
  isMiyoAvailableForCapability: jest.fn(),
  getMiyoStatusSnapshot: jest.fn(),
  refreshMiyoStatus: jest.fn(),
}));
jest.mock("@/utils/deviceId", () => ({ getDeviceId: jest.fn(() => "device-A") }));

// Controllable Miyo client; the class type is erased (type-only imports).
const resolveBaseUrl = jest.fn<Promise<string>, unknown[]>();
const getFolder = jest.fn<Promise<unknown>, unknown[]>();
const checkFolderRegistration = jest.fn<Promise<string>, unknown[]>();
const deleteFolder = jest.fn<Promise<void>, unknown[]>();
const addFolder = jest.fn<Promise<unknown>, unknown[]>();
const scanFolder = jest.fn<Promise<unknown>, unknown[]>();
jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: class {
    resolveBaseUrl = (...a: unknown[]) => resolveBaseUrl(...a);
    getFolder = (...a: unknown[]) => getFolder(...a);
    checkFolderRegistration = (...a: unknown[]) => checkFolderRegistration(...a);
    // The destructive calls run their `beforeRequest` hook before delegating,
    // exactly where the real client runs it: after URL/credential resolution and
    // before `requestUrl`. A hook that throws must therefore leave the spy
    // untouched, which is what "no request went out" means at this boundary.
    deleteFolder = (folderName: unknown, url: unknown, beforeRequest?: () => void) => {
      beforeRequest?.();
      return deleteFolder(folderName, url, beforeRequest);
    };
    addFolder = (request: unknown, url: unknown, beforeRequest?: () => void) => {
      beforeRequest?.();
      return addFolder(request, url, beforeRequest);
    };
    scanFolder = (...a: unknown[]) => scanFolder(...a);
  },
}));

const updateSetting = jest.fn<void, unknown[]>();
let currentSettings: Record<string, unknown>;
// Keep the real module (searchUtils needs its normalizeRootFolders); override
// only the settings accessors the resync reads/writes.
jest.mock("@/settings/model", () => ({
  ...jest.requireActual<object>("@/settings/model"),
  getSettings: jest.fn(() => currentSettings),
  updateSetting: (...a: unknown[]) => {
    updateSetting(...a);
  },
}));

jest.mock("@/utils/vaultPath", () => ({ getVaultBase: jest.fn(() => "/abs/vault") }));

import type { App } from "obsidian";
import type { MiyoAddFolderRequest, MiyoFolderEntry } from "@/miyo/MiyoClient";
import {
  enqueueMiyoFolderMutation,
  miyoRecordCoversSystemRoots,
  resetMiyoMutations,
  resyncMiyoFolder,
  verifyMiyoScope,
} from "@/miyo/miyoResync";
import type { MiyoMutationSession } from "@/miyo/miyoResync";
import type { CopilotSettings } from "@/settings/model";

const app = { vault: { getName: () => "my-vault" } } as unknown as App;

/** A promise whose settlement the test controls, to hold a mutation mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Stored sync receipt; defaults to this device/endpoint/folder identity. */
function receiptFor(
  over: Partial<{ device: string; url: string; folder: string; roots: string[] }> = {}
): string {
  return JSON.stringify({
    device: "device-A",
    url: "",
    folder: "my-vault",
    roots: ["copilot"],
    ...over,
  });
}

/** Folder record as Miyo returns it; loose shape like the real entry type. */
function record(over: Record<string, unknown> = {}): MiyoFolderEntry {
  return {
    path: "my-vault",
    exclude_folders: ["copilot"],
    exclude_patterns: [],
    include_folders: [],
    include_patterns: [],
    include_extensions: [],
    allow_remote_read: true,
    allow_writes: true,
    ...over,
  };
}

// Session for the lifecycle `beforeEach` established. Tests that reset mid-way
// keep a reference to this one to act as the outgoing lifecycle's producer.
let session: MiyoMutationSession;

beforeEach(() => {
  jest.clearAllMocks();
  // The mutation queue is module state that outlives a single test just as it
  // outlives a plugin lifecycle; start each test on a fresh chain and token.
  session = resetMiyoMutations();
  currentSettings = {
    copilotFolder: "copilot",
    copilotRootHistory: ["copilot"],
    miyoServerUrl: "",
    qaInclusions: "",
    qaExclusions: "copilot",
    miyoSyncedExclusions: "",
  };
  resolveBaseUrl.mockResolvedValue("http://miyo");
  deleteFolder.mockResolvedValue(undefined);
  addFolder.mockResolvedValue(record());
  scanFolder.mockResolvedValue({});
});

/** Settings for a vault whose root moved to team/ai (record above is stale). */
function rootMovedSettings(): void {
  currentSettings = {
    ...currentSettings,
    copilotFolder: "team/ai",
    copilotRootHistory: ["copilot", "team/ai"],
  };
}

describe("miyoResync", () => {
  describe("miyoRecordCoversSystemRoots()", () => {
    const movedRootSettings = () =>
      ({
        ...currentSettings,
        copilotFolder: "team/ai",
        copilotRootHistory: ["copilot", "team/ai"],
      }) as CopilotSettings;

    it("accepts a record whose exclusions are a superset of the system roots", () => {
      expect(
        miyoRecordCoversSystemRoots(
          record({ exclude_folders: ["copilot", "team/ai", "user-extra"] }),
          movedRootSettings()
        )
      ).toBe(true);
    });

    it("rejects a record missing a system root", () => {
      expect(
        miyoRecordCoversSystemRoots(record({ exclude_folders: ["copilot"] }), movedRootSettings())
      ).toBe(false);
    });

    it("ignores qa* and inclusion drift — the staleness signal is roots-only", () => {
      // The user edited qaExclusions/qaInclusions since registration but never
      // moved the root: that snapshot drift is the documented pre-existing gap,
      // not grounds for a destructive rebuild.
      const settings = {
        ...currentSettings,
        qaExclusions: "copilot,drifted-folder",
        qaInclusions: "notes",
      } as CopilotSettings;
      expect(
        miyoRecordCoversSystemRoots(
          record({ exclude_folders: ["copilot"], include_folders: ["stale-whitelist"] }),
          settings
        )
      ).toBe(true);
    });
  });

  describe("resyncMiyoFolder()", () => {
    it("verifies without rebuilding when the record already covers the scope", async () => {
      getFolder.mockResolvedValue(record());

      const outcome = await resyncMiyoFolder(app, session);

      expect(outcome).toBe("verified");
      expect(deleteFolder).not.toHaveBeenCalled();
      expect(addFolder).not.toHaveBeenCalled();
      expect(updateSetting).toHaveBeenCalledWith("miyoSyncedExclusions", expect.any(String));
    });

    it("deletes and re-registers with the fresh scope when the record is stale", async () => {
      rootMovedSettings();
      getFolder.mockResolvedValue(record()); // still only excludes "copilot"

      const outcome = await resyncMiyoFolder(app, session);

      expect(outcome).toBe("resynced");
      expect(deleteFolder).toHaveBeenCalledWith("my-vault", undefined, expect.any(Function));
      const body = addFolder.mock.calls[0][0] as MiyoAddFolderRequest;
      expect(body.path).toBe("/abs/vault");
      expect(body.exclude_folders).toEqual(expect.arrayContaining(["copilot", "team/ai"]));
      expect(updateSetting).toHaveBeenCalledWith("miyoSyncedExclusions", expect.any(String));
      expect(scanFolder).toHaveBeenCalled();
    });

    it("carries the record's Relay opt-out into the re-registration", async () => {
      rootMovedSettings();
      getFolder.mockResolvedValue(record({ allow_remote_read: false }));

      await resyncMiyoFolder(app, session);

      const body = addFolder.mock.calls[0][0] as MiyoAddFolderRequest;
      expect(body.allow_remote_read).toBe(false);
    });

    it("fails closed on Relay when the record omits the field", async () => {
      // Omitting allow_remote_read makes the server default it to TRUE —
      // silently re-enabling Relay for a user who opted out in Miyo.
      rootMovedSettings();
      const stale = record({ allow_remote_read: undefined });
      delete (stale as Record<string, unknown>).allow_remote_read;
      getFolder.mockResolvedValue(stale);

      await resyncMiyoFolder(app, session);

      const body = addFolder.mock.calls[0][0] as MiyoAddFolderRequest;
      expect(body.allow_remote_read).toBe(false);
    });

    it("does not re-register on a 404 it has no receipt to vouch for", async () => {
      // Without a receipt naming this device/endpoint/folder there is no evidence
      // this vault was ever registered here, so a 404 says "never used Miyo" —
      // not "our own rebuild was interrupted". Registering would be inventing
      // consent; the vouched-for case is covered by the next test.
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const outcome = await resyncMiyoFolder(app, session);

      expect(outcome).toBe("unregistered");
      expect(deleteFolder).not.toHaveBeenCalled();
      expect(addFolder).not.toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalled(); // empty receipt: nothing to clear
    });

    it("retries the re-add once so a transient failure keeps the record's grants", async () => {
      // The grants are only knowable in the run that deleted the record. One
      // more attempt here is the difference between preserving the user's Relay
      // setting and resetting it on the next Resync.
      rootMovedSettings();
      currentSettings.miyoSyncedExclusions = receiptFor();
      getFolder.mockResolvedValue(record({ allow_remote_read: true, allow_writes: false }));
      addFolder.mockRejectedValueOnce(new Error("connection reset"));
      addFolder.mockResolvedValue(record());

      await expect(resyncMiyoFolder(app, session)).resolves.toBe("resynced");

      expect(addFolder).toHaveBeenCalledTimes(2);
      // No `beforeRequest` on this one, deliberately: once the DELETE is out the
      // POST has to follow or the vault is left unregistered.
      expect(addFolder).toHaveBeenLastCalledWith(
        expect.objectContaining({ allow_remote_read: true, allow_writes: false }),
        undefined,
        undefined
      );
    });

    it("rebuilds its own vanished registration, and reports the grants it had to reset", async () => {
      // The receipt proves this vault WAS registered here; the server says it
      // isn't now. Refusing to re-add used to strand a rebuild that died between
      // its DELETE and its POST — every retry saw the same 404 and refused too.
      currentSettings.miyoSyncedExclusions = receiptFor();
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const outcome = await resyncMiyoFolder(app, session);

      // A distinct outcome, because the caller has to tell the user: the record
      // that carried the grants is gone, and guessing `true` would re-grant
      // Relay read to a vault whose owner had turned it off.
      expect(outcome).toBe("resynced-grants-reset");
      expect(addFolder).toHaveBeenCalledWith(
        expect.objectContaining({ allow_remote_read: false, allow_writes: false }),
        undefined,
        expect.any(Function)
      );
      expect(updateSetting).toHaveBeenCalledWith("miyoSyncedExclusions", expect.any(String));
    });

    it("recovers on a second Resync after the re-add failed mid-rebuild", async () => {
      // DELETE lands, both POST attempts throw: the registration and its index
      // are gone while the receipt still names this vault. The next Resync must
      // be able to repair that, since the same action caused it.
      rootMovedSettings();
      currentSettings.miyoSyncedExclusions = receiptFor();
      getFolder.mockResolvedValueOnce(record());
      addFolder.mockRejectedValueOnce(new Error("connection reset"));
      addFolder.mockRejectedValueOnce(new Error("connection reset"));

      await expect(resyncMiyoFolder(app, session)).resolves.toBe("failed");
      expect(deleteFolder).toHaveBeenCalledTimes(1);

      // Second click: the folder now 404s, and the receipt still vouches for it.
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");
      addFolder.mockResolvedValue(record());

      await expect(resyncMiyoFolder(app, session)).resolves.toBe("resynced-grants-reset");
      // No second DELETE — there was nothing left to delete.
      expect(deleteFolder).toHaveBeenCalledTimes(1);
    });

    it("reports a conflict and keeps the stale receipt when re-add hits 409", async () => {
      rootMovedSettings();
      getFolder.mockResolvedValue(record());
      addFolder.mockResolvedValue(null); // 409 → null per addFolder contract

      const outcome = await resyncMiyoFolder(app, session);

      expect(outcome).toBe("conflict");
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("fails without writing anything when the record can't be read", async () => {
      getFolder.mockRejectedValue(new Error("boom"));
      checkFolderRegistration.mockResolvedValue("error");

      const outcome = await resyncMiyoFolder(app, session);

      expect(outcome).toBe("failed");
      expect(deleteFolder).not.toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("still writes the receipt when only the re-scan trigger fails", async () => {
      // The scope is committed; Miyo re-scans on its own. Staying dirty would
      // provoke another destructive delete/re-add for a self-healing lag.
      rootMovedSettings();
      getFolder.mockResolvedValue(record());
      scanFolder.mockRejectedValue(new Error("scan down"));

      const outcome = await resyncMiyoFolder(app, session);

      expect(outcome).toBe("resynced-scan-failed");
      expect(updateSetting).toHaveBeenCalledWith("miyoSyncedExclusions", expect.any(String));
    });

    it("serializes concurrent runs instead of interleaving them", async () => {
      let releaseFirst!: (value: MiyoFolderEntry) => void;
      getFolder.mockImplementationOnce(
        () => new Promise<unknown>((resolve) => (releaseFirst = resolve))
      );
      getFolder.mockResolvedValue(record());

      const first = resyncMiyoFolder(app, session);
      const second = resyncMiyoFolder(app, session);
      // Flush pending microtasks so the first run reaches its blocked getFolder.
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      // The second run must not start (no second getFolder) while the first
      // still holds the mutation chain.
      expect(getFolder).toHaveBeenCalledTimes(1);

      releaseFirst(record());
      await expect(first).resolves.toBe("verified");
      await expect(second).resolves.toBe("verified");
      expect(getFolder).toHaveBeenCalledTimes(2);
    });

    it("finishes the server-side rebuild but discards the receipt when the lifecycle ends mid-flight", async () => {
      // A resync that got past DELETE must still complete its POST — abandoning
      // it between the two is exactly what strands a vault unregistered. What
      // must not survive is the receipt: this vault's settings store is gone.
      rootMovedSettings();
      currentSettings.miyoSyncedExclusions = receiptFor();
      getFolder.mockResolvedValue(record());
      const post = deferred<MiyoFolderEntry>();
      addFolder.mockReturnValueOnce(post.promise);

      const pending = resyncMiyoFolder(app, session);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      expect(deleteFolder).toHaveBeenCalledTimes(1);

      // The vault closes while the POST is outstanding.
      resetMiyoMutations();
      post.resolve(record({ exclude_folders: ["copilot", "team/ai"] }));

      // Server-side work completes; the local receipt does not follow it, and
      // the caller sees a failure rather than a success it can act on.
      await expect(pending).resolves.toBe("failed");
      expect(addFolder).toHaveBeenCalledTimes(1);
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("reports a conflict without deleting when the previous-name registration still exists", async () => {
      // GET by the current name 404s and the receipt shows THIS device+endpoint
      // under a different, still-registered name. That name may belong to
      // ANOTHER vault by now (folder names are just vault names), so nothing is
      // deleted or cleared — the user cleans up in Miyo, and the kept receipt
      // keeps verify reporting the exposure.
      currentSettings.miyoSyncedExclusions = receiptFor({ folder: "old-vault-name" });
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockImplementation((name) =>
        Promise.resolve(name === "old-vault-name" ? "registered" : "unregistered")
      );

      const outcome = await resyncMiyoFolder(app, session);

      expect(outcome).toBe("conflict");
      expect(deleteFolder).not.toHaveBeenCalled();
      expect(addFolder).not.toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("fails without accusing when the previous-name probe can't determine the state", async () => {
      // A transient error must not instruct the user to delete a registration
      // whose existence is unconfirmed; the receipt survives for the retry.
      currentSettings.miyoSyncedExclusions = receiptFor({ folder: "old-vault-name" });
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockImplementation((name) =>
        Promise.resolve(name === "old-vault-name" ? "error" : "unregistered")
      );

      const outcome = await resyncMiyoFolder(app, session);

      expect(outcome).toBe("failed");
      expect(deleteFolder).not.toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("consumes the rename receipt when the previous-name registration is confirmed gone", async () => {
      // The user already removed the old registration in Miyo: the probe
      // confirms it, so the receipt clears instead of reporting a conflict
      // forever after the user followed the cleanup instruction.
      currentSettings.miyoSyncedExclusions = receiptFor({ folder: "old-vault-name" });
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const outcome = await resyncMiyoFolder(app, session);

      expect(outcome).toBe("unregistered");
      expect(deleteFolder).not.toHaveBeenCalled();
      expect(addFolder).not.toHaveBeenCalled();
      expect(updateSetting).toHaveBeenCalledWith("miyoSyncedExclusions", "");
    });

    it("refuses to run when the endpoint flipped to a remote target while queued", async () => {
      // Callers gate on a local endpoint before enqueueing; the queued task
      // re-checks at execution so a mid-queue URL switch can't make it mutate
      // a remote registration.
      currentSettings.miyoServerUrl = "https://miyo.example.com";

      const outcome = await resyncMiyoFolder(app, session);

      expect(outcome).toBe("failed");
      expect(getFolder).not.toHaveBeenCalled();
      expect(deleteFolder).not.toHaveBeenCalled();
      expect(addFolder).not.toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("never deletes or clears based on a foreign device's receipt", async () => {
      currentSettings.miyoSyncedExclusions = receiptFor({
        device: "device-B",
        folder: "old-vault-name",
      });
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const outcome = await resyncMiyoFolder(app, session);

      expect(outcome).toBe("unregistered");
      expect(deleteFolder).not.toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("keeps the record's own exclusions instead of narrowing to the Copilot scope", async () => {
      // `PATCH /v0/folder` lets any client tighten a registration, so the record
      // is not ours alone. Replacing its filters with only the Copilot-derived
      // scope would re-index what its owner excluded — and with Relay on, expose
      // it. Excludes always win server-side, so the union is the safe direction.
      rootMovedSettings();
      getFolder.mockResolvedValue(
        record({
          exclude_folders: ["copilot", "Private"],
          exclude_patterns: ["**/secret/**"],
        })
      );

      await expect(resyncMiyoFolder(app, session)).resolves.toBe("resynced");

      const body = addFolder.mock.calls[0][0] as MiyoAddFolderRequest;
      expect(body.exclude_folders).toEqual(
        expect.arrayContaining(["copilot", "team/ai", "Private"])
      );
      expect(body.exclude_patterns).toEqual(expect.arrayContaining(["**/secret/**"]));
    });

    it("keeps the record's include whitelist rather than widening it with ours", async () => {
      // Include filters are an OR whitelist, so unioning would ADD everything
      // our side lists to what the record permitted. Preserving the record's is
      // the only direction that cannot end up broader than the server enforced.
      rootMovedSettings();
      currentSettings.qaInclusions = "Notes";
      getFolder.mockResolvedValue(record({ include_folders: ["OnlyThis"] }));

      await resyncMiyoFolder(app, session);

      const body = addFolder.mock.calls[0][0] as MiyoAddFolderRequest;
      expect(body.include_folders).toEqual(["OnlyThis"]);
    });

    it("applies our include whitelist when the record carries none", async () => {
      // No whitelist on the record means nothing is narrowed today; applying
      // ours narrows, which is the safe direction.
      rootMovedSettings();
      currentSettings.qaInclusions = "Notes";
      getFolder.mockResolvedValue(record());

      await resyncMiyoFolder(app, session);

      const body = addFolder.mock.calls[0][0] as MiyoAddFolderRequest;
      expect(body.include_folders).toEqual(expect.arrayContaining(["Notes"]));
    });

    it("still re-registers when the lifecycle ends after its DELETE went out", async () => {
      // The compensating POST deliberately carries no lifecycle hook: abandoning
      // it once the DELETE succeeded would leave the vault unregistered. So the
      // POST runs even though the lifecycle is gone — and the receipt, which is
      // guarded, is not written. This is the trade-off the reset note records.
      rootMovedSettings();
      getFolder.mockResolvedValue(record());
      const deleteLanded = deferred<void>();
      deleteFolder.mockReturnValueOnce(deleteLanded.promise);

      const pending = resyncMiyoFolder(app, session);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      expect(deleteFolder).toHaveBeenCalledTimes(1);

      resetMiyoMutations();
      deleteLanded.resolve();

      await expect(pending).resolves.toBe("failed");
      expect(addFolder).toHaveBeenCalledTimes(1);
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("reports failed without touching Miyo when the caller's session has expired", async () => {
      // The Resync button lives in a tree that is never unmounted, so a click
      // handler bound under the outgoing vault stays callable. Its stale session
      // must stop the DELETE/POST rather than rebuild the outgoing vault's
      // registration from inside the incoming one.
      rootMovedSettings();
      const staleSession = session;
      getFolder.mockResolvedValue(record());

      resetMiyoMutations();

      await expect(resyncMiyoFolder(app, staleSession)).resolves.toBe("failed");
      expect(getFolder).not.toHaveBeenCalled();
      expect(deleteFolder).not.toHaveBeenCalled();
      expect(addFolder).not.toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalled();
    });
  });

  describe("verifyMiyoScope()", () => {
    it("reports covered and self-heals the receipt when the record enforces the scope", async () => {
      getFolder.mockResolvedValue(record());
      currentSettings.miyoSyncedExclusions = receiptFor({ device: "device-B" }); // foreign, mismatch

      const verdict = await verifyMiyoScope(app, session);

      expect(verdict).toBe("covered");
      expect(updateSetting).toHaveBeenCalledWith("miyoSyncedExclusions", expect.any(String));
    });

    it("reports stale without touching the receipt when the record misses the scope", async () => {
      rootMovedSettings();
      getFolder.mockResolvedValue(record()); // only excludes "copilot"

      const verdict = await verifyMiyoScope(app, session);

      expect(verdict).toBe("stale");
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("clears the receipt on 404 only when it names exactly this device/endpoint/folder", async () => {
      currentSettings.miyoSyncedExclusions = receiptFor();
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const verdict = await verifyMiyoScope(app, session);

      expect(verdict).toBe("unregistered");
      expect(updateSetting).toHaveBeenCalledWith("miyoSyncedExclusions", "");
    });

    it("keeps the receipt and reports stale on 404 after a same-device rename", async () => {
      // The old registration still exists under the old name; the receipt is
      // the only cleanup lead and must survive.
      currentSettings.miyoSyncedExclusions = receiptFor({ folder: "old-vault-name" });
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockImplementation((name) =>
        Promise.resolve(name === "old-vault-name" ? "registered" : "unregistered")
      );

      const verdict = await verifyMiyoScope(app, session);

      expect(verdict).toBe("stale");
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("reports unknown when the previous-name probe can't determine the state", async () => {
      // Same three-state rule as the resync path: only a confirmed
      // "registered" may drive the stale banner and its cleanup instruction.
      currentSettings.miyoSyncedExclusions = receiptFor({ folder: "old-vault-name" });
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockImplementation((name) =>
        Promise.resolve(name === "old-vault-name" ? "error" : "unregistered")
      );

      const verdict = await verifyMiyoScope(app, session);

      expect(verdict).toBe("unknown");
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("consumes the rename receipt once the old-name registration is confirmed gone", async () => {
      // The user followed the cleanup prompt and removed the old registration
      // in Miyo: the probe confirms it, the receipt clears, the banner ends.
      currentSettings.miyoSyncedExclusions = receiptFor({ folder: "old-vault-name" });
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const verdict = await verifyMiyoScope(app, session);

      expect(verdict).toBe("unregistered");
      expect(updateSetting).toHaveBeenCalledWith("miyoSyncedExclusions", "");
    });

    it("never clears a non-empty receipt it cannot parse", async () => {
      // An unparseable value can't be attributed to any identity; wiping it
      // would sync out and destroy whatever evidence it holds elsewhere.
      currentSettings.miyoSyncedExclusions = "not-json";
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const verdict = await verifyMiyoScope(app, session);

      expect(verdict).toBe("unregistered");
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("leaves a foreign device's receipt untouched on 404", async () => {
      // Clearing it would clobber the other device's evidence via settings sync.
      currentSettings.miyoSyncedExclusions = receiptFor({ device: "device-B" });
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const verdict = await verifyMiyoScope(app, session);

      expect(verdict).toBe("unregistered");
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("reports unknown when the registration state can't be determined", async () => {
      getFolder.mockRejectedValue(new Error("boom"));
      checkFolderRegistration.mockResolvedValue("error");

      const verdict = await verifyMiyoScope(app, session);

      expect(verdict).toBe("unknown");
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("times out a hung lookup so the mutation chain keeps moving", async () => {
      jest.useFakeTimers();
      try {
        // A Miyo that accepts the connection but never responds must not hold
        // the chain forever: the lookup timeout fails this verify, and a
        // queued resync still gets its turn.
        getFolder.mockImplementationOnce(() => new Promise<never>(() => {}));
        checkFolderRegistration.mockResolvedValue("error");

        const verify = verifyMiyoScope(app, session);
        await jest.advanceTimersByTimeAsync(10_001);
        await expect(verify).resolves.toBe("unknown");

        getFolder.mockResolvedValue(record());
        await expect(verifyMiyoScope(app, session)).resolves.toBe("covered");
      } finally {
        jest.useRealTimers();
      }
    });

    it("reports unknown without writing a receipt when the caller's session has expired", async () => {
      // The root-change probe fires from an async tail that can outlive its
      // vault. A covering record would otherwise self-heal the receipt — into
      // whichever vault is open by then, describing a scope that is not its own.
      const staleSession = session;
      getFolder.mockResolvedValue(record());

      resetMiyoMutations();

      await expect(verifyMiyoScope(app, staleSession)).resolves.toBe("unknown");
      expect(getFolder).not.toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalled();
    });
  });

  describe("resetMiyoMutations()", () => {
    it("lets a new lifecycle run while a previous mutation is still hung", async () => {
      // The failure this exists to fix: mutations are deliberately untimed, so
      // without a fresh chain a request that never returns would block every
      // Miyo operation for the newly opened vault.
      const hung = deferred<MiyoFolderEntry>();
      getFolder.mockReturnValueOnce(hung.promise);
      getFolder.mockResolvedValue(record());

      const stranded = resyncMiyoFolder(app, session);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      expect(getFolder).toHaveBeenCalledTimes(1);

      const nextLifecycle = resetMiyoMutations();

      // Runs to completion with the first request still outstanding. Uses the
      // session the reset handed back — the incoming lifecycle's own proof.
      await expect(resyncMiyoFolder(app, nextLifecycle)).resolves.toBe("verified");

      hung.resolve(record());
      await expect(stranded).resolves.toBe("failed");
    });

    it("keeps a mutation queued behind the old chain from ever starting", async () => {
      // A task that had not begun when the vault closed must not issue requests
      // at all — unlike a started one, nothing is half-done that needs finishing.
      const hung = deferred<MiyoFolderEntry>();
      getFolder.mockReturnValueOnce(hung.promise);
      getFolder.mockResolvedValue(record());

      const running = resyncMiyoFolder(app, session);
      const queued = resyncMiyoFolder(app, session);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      expect(getFolder).toHaveBeenCalledTimes(1);

      resetMiyoMutations();
      hung.resolve(record());

      await expect(running).resolves.toBe("failed");
      await expect(queued).resolves.toBe("failed");
      // The queued run never reached its own lookup.
      expect(getFolder).toHaveBeenCalledTimes(1);
      expect(updateSetting).not.toHaveBeenCalled();
    });
  });

  describe("enqueueMiyoFolderMutation()", () => {
    it("rejects a task that completed after its lifecycle ended", async () => {
      // The register flow writes its receipt in the caller's continuation, after
      // the awaited call returns — outside anything this module can guard. Only
      // rejecting the promise keeps that continuation from running, so this is
      // the contract that stops one vault's registration from landing in another.
      const started = deferred<void>();
      const finish = deferred<string>();
      const pending = enqueueMiyoFolderMutation(() => {
        started.resolve();
        return finish.promise;
      }, session);
      await started.promise;

      resetMiyoMutations();
      finish.resolve("would-have-been-returned");

      await expect(pending).rejects.toThrow();
    });

    it("resolves with the task's value when the lifecycle is still current", async () => {
      await expect(enqueueMiyoFolderMutation(async () => "value", session)).resolves.toBe("value");
    });

    it("refuses a producer whose session predates the current lifecycle", async () => {
      // The producers that can reach here after a vault switch — the settings
      // tab's never-unmounted React tree, an open MiyoConnectModal, the
      // root-change async tail — hold a session taken when they were created.
      // Reading the token at enqueue time instead would hand them the incoming
      // vault's token and let them act on it.
      const staleSession = session;
      const task = jest.fn(async () => "ran");

      resetMiyoMutations();

      await expect(enqueueMiyoFolderMutation(task, staleSession)).rejects.toThrow();
      expect(task).not.toHaveBeenCalled();
    });

    it("stops an in-flight mutation before it can delete on a closed vault's behalf", async () => {
      // The previous coverage let the stale task's lookup return a covering
      // record, so it only ever tried to write a receipt. Park it on a lookup
      // that comes back STALE instead: without a guard before the DELETE, the
      // task would go on to rebuild a registration for a vault that is gone.
      rootMovedSettings();
      currentSettings.miyoSyncedExclusions = receiptFor();
      const lookup = deferred<MiyoFolderEntry>();
      getFolder.mockReturnValueOnce(lookup.promise);

      const stranded = resyncMiyoFolder(app, session);
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      resetMiyoMutations();
      lookup.resolve(record());

      await expect(stranded).resolves.toBe("failed");
      expect(deleteFolder).not.toHaveBeenCalled();
      expect(addFolder).not.toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalled();
    });
  });
});
