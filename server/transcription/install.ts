/**
 * What `npm run transcription:setup` installs, and where (Phase 3 brief,
 * decision 7, as decided at the WP3 check-in): whisper.cpp's Windows CUDA
 * build with large-v3-turbo-q5_0, and sherpa-onnx's speaker diarization with
 * pyannote segmentation-3.0 and 3D-Speaker ERes2Net. Each is pinned by
 * version and SHA-256, as WP2 pinned them (`spikes/transcription/files.ts`,
 * checked on 2026-11-11), and its licence is kept beside it.
 *
 * Everything goes in `~/.stylecode/transcription/`, outside the repository
 * and the data folder. StyleCode itself never downloads anything: the app
 * reads what the setup installed, and says what to run when nothing is there.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { EngineUsed } from '../../src/workspace/model/types.ts';

/** Where the programs and models live. A test can point it elsewhere. */
export const transcriptionHome = () => process.env.STYLECODE_TRANSCRIPTION_HOME ?? join(homedir(), '.stylecode', 'transcription');

/** The settings file (decision 7): past speeds, for estimates. */
export const settingsFile = () =>
  process.env.STYLECODE_TRANSCRIPTION_SETTINGS ?? join(homedir(), '.stylecode', 'transcription.json');

export const SETUP_COMMAND = 'npm run transcription:setup';

export interface PinnedFile {
  id: string;
  name: string;
  version: string;
  url: string;
  bytes: number;
  sha256: string;
  licence: string;
  /** Where it ends up, relative to the transcription folder: a folder for an archive, a file otherwise. */
  installed: string;
  /** 'top': the archive holds its own folder; 'into-folder': unpack into `installed`. */
  unpack?: 'top' | 'into-folder';
}

const WHISPER_TAG = 'b5454'; // whisper.cpp v1.9.5's Windows builds, on the same commit d1be6fd.
const WHISPER_MODELS = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1';
const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
const SHERPA_FOLDER = 'sherpa-onnx-v2.0.1-win-x64-shared-MD-Release';

export const PINNED: PinnedFile[] = [
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
    id: 'sherpa-onnx',
    name: 'sherpa-onnx v2.0.1, Windows x64 (shared, Release)',
    version: 'v2.0.1',
    url: `${SHERPA}/v2.0.1/${SHERPA_FOLDER}.tar.bz2`,
    bytes: 21921136,
    sha256: 'ce987d5bfca42c74b54f7b3bbaaa8c1febe3c5cd0fea8f94be80ea30e72f1f61',
    licence: 'Apache-2.0 (https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.1/LICENSE)',
    installed: SHERPA_FOLDER,
    unpack: 'top',
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

/** The programs and models, at their installed paths. */
export function installedPaths(home = transcriptionHome()) {
  return {
    whisperCli: join(home, 'whisper-cuda', 'Release', 'whisper-cli.exe'),
    whisperModel: join(home, 'models', 'ggml-large-v3-turbo-q5_0.bin'),
    diarization: join(home, SHERPA_FOLDER, 'bin', 'sherpa-onnx-offline-speaker-diarization.exe'),
    segmentation: join(home, 'sherpa-onnx-pyannote-segmentation-3-0', 'model.onnx'),
    embedding: join(home, 'models', '3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx'),
  };
}

/** What a transcript says made it (decision 18; "Not the AI's colour" in the brief's clarifications). */
export const TRANSCRIBER: EngineUsed = { name: 'whisper.cpp', version: '1.9.5', models: ['large-v3-turbo-q5_0'] };
export const SPEAKER_ENGINE: EngineUsed = {
  name: 'sherpa-onnx',
  version: '2.0.1',
  models: ['pyannote segmentation-3.0', '3D-Speaker ERes2Net (English)'],
};

/**
 * The settings WP3 chose (TRANSCRIPTION.md, "Decided at the check-in"):
 * Whisper with `--max-context 0`, no VAD and no names prompt; speakers by
 * ERes2Net at threshold 0.7, without the count, with the default shortest speech.
 */
export const SPEAKER_THRESHOLD = 0.7;
