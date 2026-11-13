/**
 * Every candidate of the transcription test (Phase 3 brief, decisions 5 and
 * 6), pinned by version and SHA-256, with its licence. Checked on 2026-11-11.
 * The Hugging Face models are pinned to a repository commit.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SPIKE_HOME = process.env.STYLECODE_TRANSCRIPTION_SPIKE ?? join(homedir(), '.stylecode', 'transcription', 'spike');

export interface CandidateFile {
  id: string;
  name: string;
  version: string;
  url: string;
  bytes: number;
  sha256: string;
  licence: string;
  /** Where it ends up, relative to SPIKE_HOME: a folder for an archive, a file otherwise. */
  installed: string;
  /** 'top': the archive holds its own folder; 'into-folder': unpack into `installed`. */
  unpack?: 'top' | 'into-folder';
}

const WHISPER_TAG = 'b5454'; // whisper.cpp v1.9.5's Windows builds, on the same commit d1be6fd.
const WHISPER_MODELS = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1';
const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

export const CANDIDATE_FILES: CandidateFile[] = [
  {
    id: 'whisper-cuda',
    name: 'whisper.cpp, Windows x64 with CUDA 12.4',
    version: `${WHISPER_TAG} (v1.9.5, commit d1be6fde11ac6e0407606b4e42fe72d34add8037)`,
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-bin-win-cuda-12.4.0-x64.zip`,
    bytes: 684913404,
    sha256: 'afef0b881c500958921c3f5523b50e59ee2ec9b6f5cbd25b324c51ed308a957a',
    licence:
      'MIT (https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE); the CUDA runtime libraries in the zip are under NVIDIA’s CUDA EULA',
    installed: 'whisper-cuda',
    unpack: 'into-folder',
  },
  {
    id: 'whisper-cpu',
    name: 'whisper.cpp, Windows x64, CPU only',
    version: `${WHISPER_TAG} (v1.9.5, commit d1be6fde11ac6e0407606b4e42fe72d34add8037)`,
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-bin-x64.zip`,
    bytes: 8928640,
    sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
    licence: 'MIT (https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)',
    installed: 'whisper-cpu',
    unpack: 'into-folder',
  },
  {
    id: 'whisper-large-v3-turbo-q5_0',
    name: 'Whisper large-v3-turbo, 5-bit (ggml)',
    version: 'ggerganov/whisper.cpp@5359861',
    url: `${WHISPER_MODELS}/ggml-large-v3-turbo-q5_0.bin`,
    bytes: 574041195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    licence: 'MIT (Whisper’s weights, https://github.com/openai/whisper/blob/main/LICENSE)',
    installed: 'models/ggml-large-v3-turbo-q5_0.bin',
  },
  {
    id: 'whisper-small',
    name: 'Whisper small (ggml)',
    version: 'ggerganov/whisper.cpp@5359861',
    url: `${WHISPER_MODELS}/ggml-small.bin`,
    bytes: 487601967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    licence: 'MIT (Whisper’s weights, https://github.com/openai/whisper/blob/main/LICENSE)',
    installed: 'models/ggml-small.bin',
  },
  {
    id: 'sherpa-onnx',
    name: 'sherpa-onnx v2.0.1, Windows x64 (shared, Release)',
    version: 'v2.0.1',
    url: `${SHERPA}/v2.0.1/sherpa-onnx-v2.0.1-win-x64-shared-MD-Release.tar.bz2`,
    bytes: 21921136,
    sha256: 'ce987d5bfca42c74b54f7b3bbaaa8c1febe3c5cd0fea8f94be80ea30e72f1f61',
    licence: 'Apache-2.0 (https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.1/LICENSE)',
    installed: 'sherpa-onnx-v2.0.1-win-x64-shared-MD-Release',
    unpack: 'top',
  },
  {
    id: 'parakeet-tdt-0.6b-v2-int8',
    name: 'NVIDIA Parakeet TDT 0.6B v2, int8, for sherpa-onnx',
    version: 'sherpa-onnx asr-models release',
    url: `${SHERPA}/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2`,
    bytes: 482440461,
    sha256: '6fc4426b54aa549a0019b8a75b8dea59164e71790a37ac56a045ad57f915f714',
    licence: 'CC-BY-4.0 (https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2)',
    installed: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
    unpack: 'top',
  },
  {
    id: 'silero-vad',
    name: 'Silero VAD (ONNX)',
    version: 'sherpa-onnx asr-models release',
    url: `${SHERPA}/asr-models/silero_vad.onnx`,
    bytes: 643854,
    sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
    licence: 'MIT (https://github.com/snakers4/silero-vad/blob/master/LICENSE)',
    installed: 'models/silero_vad.onnx',
  },
  {
    // whisper.cpp's own VAD (`--vad`), so Whisper skips stretches without speech (reviewer, 13 November).
    // Checked on 2026-11-13: the repository's licence is MIT; whisper.cpp v1.9.5's download-vad-model.sh offers v5.1.2 and v6.2.0.
    id: 'silero-vad-ggml',
    name: 'Silero VAD v6.2.0, converted to ggml for whisper.cpp',
    version: 'ggml-org/whisper-vad@9ffd54a',
    url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin',
    bytes: 885098,
    sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987',
    licence: 'MIT (https://huggingface.co/ggml-org/whisper-vad)',
    installed: 'models/ggml-silero-v6.2.0.bin',
  },
  {
    id: 'pyannote-segmentation-3.0',
    name: 'pyannote segmentation-3.0, converted to ONNX by sherpa-onnx',
    version: 'sherpa-onnx speaker-segmentation-models release',
    url: `${SHERPA}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`,
    bytes: 6958444,
    sha256: '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488',
    licence: 'MIT (https://huggingface.co/pyannote/segmentation-3.0)',
    installed: 'sherpa-onnx-pyannote-segmentation-3-0',
    unpack: 'top',
  },
  {
    id: '3dspeaker-campplus-en',
    name: '3D-Speaker CAM++, English (VoxCeleb), speaker embeddings',
    version: 'sherpa-onnx speaker-recongition-models release',
    url: `${SHERPA}/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx`,
    bytes: 29596978,
    sha256: '357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b',
    licence: 'Apache-2.0 (https://github.com/modelscope/3D-Speaker)',
    installed: 'models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',
  },
  {
    id: '3dspeaker-eres2net-en',
    name: '3D-Speaker ERes2Net, English (VoxCeleb), speaker embeddings',
    version: 'sherpa-onnx speaker-recongition-models release',
    url: `${SHERPA}/speaker-recongition-models/3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx`,
    bytes: 26485263,
    sha256: 'c59158379255ad66e161679cca6af8d52d51e389e3224ab7d7a7baae295c2db5',
    licence: 'Apache-2.0 (https://github.com/modelscope/3D-Speaker)',
    installed: 'models/3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx',
  },
];
