export type DownloadableModel = {
  id: string;
  name: string;
  description: string;
  memory: string;
  recommended?: boolean;
  repository: string;
  revision: string;
  filename: string;
  bytes: number;
  sha256: string;
  license: string;
};

// Public, ungated GGUFs. Revisions, sizes and LFS SHA-256 values were checked
// against the publishers' Hugging Face metadata on 2026-09-12.
export const MODEL_CATALOG: readonly DownloadableModel[] = [
  {
    id: 'qwen3-0.6b-q4',
    name: 'Qwen3 0.6B',
    description: 'Start here. A compact model for chat and short incident explanations.',
    memory: 'Suggested phone RAM: 4 GB or more',
    recommended: true,
    repository: 'unsloth/Qwen3-0.6B-GGUF',
    revision: '50968a4468ef4233ed78cd7c3de230dd1d61a56b',
    filename: 'Qwen3-0.6B-Q4_K_M.gguf',
    bytes: 396705472,
    sha256: 'ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a',
    license: 'Apache 2.0',
  },
  {
    id: 'qwen2.5-coder-0.5b-q4',
    name: 'Qwen2.5-Coder 0.5B',
    description: 'A small coding model for short code questions and simple patch drafts.',
    memory: 'Suggested phone RAM: 4 GB or more',
    repository: 'Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF',
    revision: 'ebb2015119c907b064c512bf053e945850b5875f',
    filename: 'qwen2.5-coder-0.5b-instruct-q4_k_m.gguf',
    bytes: 491400064,
    sha256: '1d9614638d18024d0fbb36575a15f1302a3adf044df10345688ec4f6e1c4ff32',
    license: 'Apache 2.0',
  },
  {
    id: 'qwen3-1.7b-q4',
    name: 'Qwen3 1.7B',
    description: 'More capacity for detailed answers, with a larger download and slower responses.',
    memory: 'Suggested phone RAM: 6 GB or more',
    repository: 'unsloth/Qwen3-1.7B-GGUF',
    revision: 'd7f544eead698dbd1f15126ef60b45a1e1933222',
    filename: 'Qwen3-1.7B-Q4_K_M.gguf',
    bytes: 1107409472,
    sha256: 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897',
    license: 'Apache 2.0',
  },
  {
    id: 'qwen2.5-coder-1.5b-q4',
    name: 'Qwen2.5-Coder 1.5B',
    description: 'A larger Qwen2.5 coding option for code explanations and small patch drafts.',
    memory: 'Suggested phone RAM: 6 GB or more',
    repository: 'Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF',
    revision: 'f86cb2c1fa58255f8052cc32aeede1b7482d4361',
    filename: 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf',
    bytes: 1117320768,
    sha256: 'cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046',
    license: 'Apache 2.0',
  },
  {
    id: 'qwen3-4b-q4',
    name: 'Qwen3 4B',
    description: 'Our largest on-device option for more detailed reasoning and code questions.',
    memory: 'Suggested phone RAM: 8 GB or more',
    repository: 'unsloth/Qwen3-4B-GGUF',
    revision: '22c9fc8a8c7700b76a1789366280a6a5a1ad1120',
    filename: 'Qwen3-4B-Q4_K_M.gguf',
    bytes: 2497281312,
    sha256: 'f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a',
    license: 'Apache 2.0',
  },
];

export const modelSource = (model: DownloadableModel) =>
  `https://huggingface.co/${model.repository}/tree/${model.revision}`;
export const modelDownloadUrl = (model: DownloadableModel) =>
  `https://huggingface.co/${model.repository}/resolve/${model.revision}/${model.filename}`;
export const formatBytes = (bytes: number) =>
  bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(2)} GB`
    : `${Math.round(bytes / 1_000_000)} MB`;
