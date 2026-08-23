import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelSettingsUpdate,
  extractModelSettings,
  getModelSettings,
  type ModelSettingsDraft,
} from "./model-settings-api";

test("builds a trimmed update without sending an empty API key", () => {
  const draft: ModelSettingsDraft = {
    baseUrl: "  http://localhost:8317/v1/// ",
    apiKey: "   ",
    clearApiKey: false,
  };

  assert.deepEqual(buildModelSettingsUpdate(draft), {
    baseUrl: "http://localhost:8317/v1",
  });
});

test("keeps an explicit clear-api-key decision separate from an untouched field", () => {
  assert.deepEqual(
    buildModelSettingsUpdate({
      baseUrl: "https://example.com/v1",
      apiKey: "",
      clearApiKey: true,
    }),
    {
      baseUrl: "https://example.com/v1",
      clearApiKey: true,
    },
  );
});

test("reads the existing API envelope without exposing an API key field", () => {
  assert.deepEqual(
    extractModelSettings({
      data: {
        baseUrl: "http://localhost:8317/v1",
        apiKeyConfigured: true,
        apiKeyMasked: "cpa_••••90",
        modelCount: 8,
        apiKey: "must-not-be-used",
      },
    }),
    {
      baseUrl: "http://localhost:8317/v1",
      apiKeyConfigured: true,
      apiKeyMasked: "cpa_••••90",
      modelCount: 8,
    },
  );
});

test("requests model settings through the frontend proxy", async () => {
  let requestedUrl = "";
  const settings = await getModelSettings(async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ data: { baseUrl: "", apiKeyConfigured: false } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  assert.equal(requestedUrl, "/api/model/settings");
  assert.deepEqual(settings, { baseUrl: "", apiKeyConfigured: false });
});
