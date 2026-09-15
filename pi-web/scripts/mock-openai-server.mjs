/**
 * A tiny stand-in for a vLLM / llama.cpp / SGLang endpoint, so the model pull can be tested
 * without one running: it answers `GET /v1/models` the way those servers do.
 *
 * Usage: node scripts/mock-openai-server.mjs [port]
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8123);
const models = [
	{ id: "Qwen/Qwen3-32B", max_model_len: 131072, owned_by: "vllm" },
	{ id: "Qwen/Qwen3-8B", max_model_len: 32768, owned_by: "vllm" },
	{ id: "deepseek-ai/DeepSeek-V3", max_model_len: 65536, owned_by: "vllm" },
];

const server = createServer((request, response) => {
	if (request.url?.startsWith("/v1/models")) {
		response.writeHead(200, { "content-type": "application/json" });
		// vLLM's reply: a data array; context length rides along as max_model_len.
		response.end(
			JSON.stringify({
				data: models.map((model) => ({
					context_length: model.max_model_len,
					id: model.id,
					max_tokens: Math.min(8192, model.max_model_len),
					object: "model",
					owned_by: model.owned_by,
				})),
				object: "list",
			}),
		);
		return;
	}
	response.writeHead(404, { "content-type": "application/json" });
	response.end(JSON.stringify({ error: { message: "not found" } }));
});

server.listen(port, "127.0.0.1", () => {
	console.log(`mock openai endpoint on http://127.0.0.1:${String(port)}/v1`);
});
