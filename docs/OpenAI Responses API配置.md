# OpenAI Responses API 配置

## 接口支持范围

当前版本仅支持 OpenAI Responses API 接口，不支持 Chat Completions API，也不支持通过 `provider` 切换其他模型供应商。

兼容服务必须实现与 OpenAI Responses API 一致的请求和响应协议。`base_url` 只用于指定该接口的基础地址，不代表项目支持该服务的其他私有协议。

## 模型选项

应用启动时使用同一组 `api_key` 和 `base_url` 请求一次 `GET {base_url}/models`，读取响应 `data` 数组中的模型 `id`，并按供应商返回顺序缓存在内存中。应用运行期间不会重新查询供应商，修改配置或刷新模型列表都需要重启应用。

模型查询失败不会阻止应用启动。`api_key` 或 `base_url` 为空、供应商不可用、请求超时或响应格式错误时，模型选项接口通过统一 `R` 结构返回 `success=false` 和错误码，HTTP 状态保持 200，前端仍允许手动填写模型名称。模型列表接口只提供候选项，不保证返回的每个模型都支持 Responses API。

## `setting.json`

应用首次启动时会在 `.mboo` 应用数据目录创建 `setting.json`。完整默认结构如下：

```json
{
  "api_key": "",
  "base_url": "",
  "ignored_file_patterns": [
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "credentials.json",
    "credentials.yml",
    "credentials.yaml",
    "secrets.json",
    "secrets.yml",
    "secrets.yaml"
  ],
  "ignored_file_pattern_exceptions": [
    ".env.example",
    ".env.template",
    ".env.sample"
  ]
}
```

配置字段：

| 字段 | 说明 |
| --- | --- |
| `api_key` | OpenAI Responses API 的访问密钥 |
| `base_url` | OpenAI Responses API 的基础地址，通常包含 `/v1` |
| `ignored_file_patterns` | 文件工具全局忽略规则 |
| `ignored_file_pattern_exceptions` | 文件工具全局忽略规则的例外 |

旧配置中遗留的 `provider` 字段不再生效，可以删除。配置只在应用启动时读取，修改后需要重启应用。
