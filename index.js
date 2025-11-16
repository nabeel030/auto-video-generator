const fs = require('fs');
const path = require('path');
const process = require('process');

// ---------- Config ----------

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'sk_0482e1026385e70467552530c58bf253d80dcf4e4b3c61e4';

if (!ELEVENLABS_API_KEY) {
  console.error('Error: Please set ELEVENLABS_API_KEY in your environment.');
  process.exit(1);
}

// Jessica + multilingual v2 (these match your “perfect” settings from history)
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'cgSgspJ2msm6clMCkdW9';
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

// Prefer env var for security
const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY || "sk_V2_hgu_k4jCl9wPlH2_CorF4sCreUxPbxZsN8xPSIxz7WKCfHjD";

if (!HEYGEN_API_KEY) {
  console.error('Error: Please set HEYGEN_API_KEY in your environment.');
  process.exit(1);
}

const UPLOAD_ASSET_URL = 'https://upload.heygen.com/v1/asset';
const PHOTO_AVATAR_GROUP_CREATE_URL = 'https://api.heygen.com/v2/photo_avatar/avatar_group/create';
const AVATAR_GROUP_AVATARS_URL = (groupId) =>
  `https://api.heygen.com/v2/avatar_group/${encodeURIComponent(groupId)}/avatars`;
const ADD_MOTION_URL = 'https://api.heygen.com/v2/photo_avatar/add_motion';
const VIDEO_GENERATE_URL = 'https://api.heygen.com/v2/video/generate';
const VIDEO_STATUS_URL = 'https://api.heygen.com/v1/video_status.get';

// ---------- Helpers ----------

// ---------- ElevenLabs TTS: generate audio file from text ----------

async function generateElevenLabsAudioToFile(text, outPath) {
  console.log('▶ Generating audio via ElevenLabs...');

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    ELEVENLABS_VOICE_ID
  )}`;

  const body = {
    text,
    model_id: ELEVENLABS_MODEL_ID,
    voice_settings: {
      similarity_boost: 0.75,
      stability: 0.5,
      style: 0,
      use_speaker_boost: true,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `ElevenLabs TTS failed. HTTP ${res.status} ${res.statusText}: ${errText}`
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await fs.promises.writeFile(outPath, buffer);

  console.log('✔ ElevenLabs audio generated at:', outPath);
  return outPath;
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Api-Key': HEYGEN_API_KEY,
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${url}: ${text}`);
  }

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${res.statusText} from ${url}:\n${text}`
    );
  }

  return data;
}

async function downloadFile(url, outPath) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download video: HTTP ${res.status}`);
    }
  
    // In Node fetch, body is a Web ReadableStream, so use arrayBuffer()
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
  
    await fs.promises.writeFile(outPath, buffer);
  }

// Very small helper to infer content type from extension
function guessContentType(filePath, fallback) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a') return 'audio/mp4';
  return fallback || 'application/octet-stream';
}

// ---------- Step 1: Upload avatar image (local file) ----------

async function uploadImageAsset(imagePath) {
  console.log('▶ Uploading image asset:', imagePath);

  const contentType = guessContentType(imagePath, 'image/jpeg');
  const fileBuffer = fs.readFileSync(imagePath);

  const res = await fetch(UPLOAD_ASSET_URL, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'X-Api-Key': HEYGEN_API_KEY,
      'Content-Length': fileBuffer.length,
    },
    body: fileBuffer,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Upload image failed. HTTP ${res.status}: ${JSON.stringify(json)}`
    );
  }

  const imageKey =
    json.data?.image_key || json.data?.id || json.data?.asset_id;

  if (!imageKey) {
    throw new Error(
      'No image_key in upload response: ' + JSON.stringify(json)
    );
  }

  console.log('✔ Image uploaded. image_key:', imageKey);
  return imageKey;
}

// ---------- Step 6: Upload audio (local file) ----------

async function uploadAudioAsset(audioPath) {
  console.log('▶ Uploading audio asset:', audioPath);

  const contentType = guessContentType(audioPath, 'audio/mpeg');
  const fileBuffer = fs.readFileSync(audioPath);

  const res = await fetch(UPLOAD_ASSET_URL, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'X-Api-Key': HEYGEN_API_KEY,
      'Content-Length': fileBuffer.length,
    },
    body: fileBuffer,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Upload audio failed. HTTP ${res.status}: ${JSON.stringify(json)}`
    );
  }

  const audioAssetId = json.data?.id || json.data?.asset_id;
  if (!audioAssetId) {
    throw new Error(
      'No audio asset id in upload response: ' + JSON.stringify(json)
    );
  }

  console.log('✔ Audio uploaded. audio_asset_id:', audioAssetId);
  return audioAssetId;
}

// ---------- Step 2: Create Photo Avatar Group from image_key ----------

async function createAvatarGroup(imageKey) {
  console.log('▶ Creating photo avatar group...');

  const payload = {
    name: 'Generated Talking Photo',
    image_key: imageKey,
  };

  const res = await jsonFetch(PHOTO_AVATAR_GROUP_CREATE_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const groupId = res.data?.group_id;
  if (!groupId) {
    throw new Error(
      'No group_id in avatar_group.create response: ' + JSON.stringify(res)
    );
  }

  console.log('✔ Avatar group created. group_id:', groupId);
  return groupId;
}

// ---------- Step 3: Get base talking photo id from avatar group ----------

async function getBaseTalkingPhotoId(groupId) {
  console.log('▶ Fetching avatar list for group:', groupId);

  const res = await jsonFetch(AVATAR_GROUP_AVATARS_URL(groupId), {
    method: 'GET',
  });

  const list = res.data?.avatar_list || [];
  if (!list.length) {
    throw new Error('Avatar list empty for group: ' + groupId);
  }

  const id = list[0].id;
  if (!id) {
    throw new Error(
      'Avatar has no id: ' + JSON.stringify(list[0])
    );
  }

  console.log('✔ Base talking photo id:', id);
  return id;
}

// ---------- NEW: Step 3.5 – Wait for base photo avatar to complete ----------

async function waitForBasePhotoAvatarCompleted(
  groupId,
  avatarId,
  { intervalMs = 5000, maxAttempts = 60 } = {}
) {
  console.log('▶ Waiting for base photo avatar to complete...');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await jsonFetch(AVATAR_GROUP_AVATARS_URL(groupId), {
      method: 'GET',
    });

    const list = res.data?.avatar_list || [];
    const found = list.find((av) => av.id === avatarId);

    const status = found?.status;
    console.log(`  Attempt ${attempt}: base avatar status = ${status || 'unknown'}`);

    if (status === 'completed') {
      console.log('✔ Base photo avatar completed.');
      return;
    }

    if (status === 'failed') {
      throw new Error(
        'Base photo avatar generation failed: ' + JSON.stringify(found)
      );
    }

    await sleep(intervalMs);
  }

  throw new Error('Timed out waiting for base photo avatar to complete.');
}

async function addMotionToTalkingPhoto(talkingPhotoId) {
    console.log('▶ Adding motion to talking photo:', talkingPhotoId);
  
    const payload = {
      id: talkingPhotoId,
      // Calm, not over-animated
      prompt:
        'Speak in a calm, friendly manner with subtle eye movement and small, natural head motions. Avoid exaggerated blinking or fast head movements.',
      // MUST be one of: 'consistent', 'consistent_gen_3', 'expressive', 'veo2', 'veo3.1', 'hailuo_2', 'seedance_lite', 'kling', 'runway_gen4', 'runway_gen3', 'avatar_iv'
      motion_type: 'consistent',
    };
  
    const res = await jsonFetch(ADD_MOTION_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  
    const motionId = res.data?.id;
    if (!motionId) {
      throw new Error(
        'No motion id returned from add_motion: ' + JSON.stringify(res)
      );
    }
  
    console.log('✔ Motion added. talking_photo_with_motion_id:', motionId);
    return motionId;
  }
  

// ---------- Step 5: Wait until motion avatar is ready ----------

async function waitForTalkingPhotoReady(
  groupId,
  talkingPhotoId,
  { intervalMs = 5000, maxAttempts = 60 } = {}
) {
  console.log('▶ Waiting for talking photo with motion to be ready...');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await jsonFetch(AVATAR_GROUP_AVATARS_URL(groupId), {
      method: 'GET',
    });

    const list = res.data?.avatar_list || [];
    const found = list.find((av) => av.id === talkingPhotoId);

    const status = found?.status;
    console.log(`  Attempt ${attempt}: status = ${status || 'unknown'}`);

    if (status === 'completed') {
      console.log('✔ Talking photo is ready with motion.');
      return;
    }

    if (status === 'failed') {
      throw new Error(
        'Talking photo motion failed: ' + JSON.stringify(found)
      );
    }

    await sleep(intervalMs);
  }

  throw new Error('Timed out waiting for talking photo motion to complete.');
}

async function generateVideo(talkingPhotoId, audioAssetId) {
    console.log('▶ Generating video from talking photo + audio...');
  
    const payload = {
      video_inputs: [
        {
          character: {
            type: 'talking_photo',
            talking_photo_id: talkingPhotoId,
          },
          voice: {
            type: 'audio',
            audio_asset_id: audioAssetId,
            // These hints are optional but often supported and safe to pass.
            // They help the backend pick a lip-sync mode.
            audio_config: {
              speaking_rate: 1.0,     // 1.0 = normal
              volume_gain_db: 0.0,    // no volume change
            },
          },
          background: {
            type: 'color',
            value: '#FFFFFF',
          },
        },
      ],
      dimension: {
        width: 720,
        height: 1280,
      },
      // Helpful metadata; some backends honour this
      caption_config: {
        // disable captions if they try to auto-generate from audio; can sometimes affect processing
        enabled: false,
      },
    };
  
    const res = await jsonFetch(VIDEO_GENERATE_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  
    const videoId = res.data?.video_id;
    if (!videoId) {
      throw new Error(
        'No video_id in video.generate response: ' + JSON.stringify(res)
      );
    }
  
    console.log('✔ Video generation started. video_id:', videoId);
    return videoId;
  }
  

// ---------- Step 8: Wait for video + download ----------

async function waitForVideoAndDownload(
  videoId,
  outputPath,
  { intervalMs = 5000, maxAttempts = 60 } = {}
) {
  console.log('▶ Waiting for video rendering to complete...');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const url = `${VIDEO_STATUS_URL}?video_id=${encodeURIComponent(videoId)}`;
    const res = await jsonFetch(url, { method: 'GET' });

    const status = res.data?.status;
    console.log(`  Attempt ${attempt}: status = ${status}`);

    if (status === 'completed') {
      const videoUrl = res.data?.video_url;
      if (!videoUrl) {
        throw new Error(
          'Video completed but video_url missing: ' + JSON.stringify(res)
        );
      }

      console.log('✔ Video ready. Downloading:', videoUrl);
      await downloadFile(videoUrl, outputPath);
      console.log('✅ Done! Video saved to:', outputPath);
      return;
    }

    if (status === 'failed') {
      throw new Error(
        'Video generation failed: ' + JSON.stringify(res.data?.error || res.data)
      );
    }

    await sleep(intervalMs);
  }

  throw new Error('Timed out waiting for video to complete.');
}

// ---------- Main CLI ----------

async function main() {
  const [imagePathArg, scriptPathArg, outArg] = process.argv.slice(2);

  if (!imagePathArg || !scriptPathArg) {
    console.error(
      'Usage:\n' +
        '  HEYGEN_API_KEY=your_heygen_key ELEVENLABS_API_KEY=your_eleven_key node index.js avatar.jpg script.txt [output.mp4]'
    );
    process.exit(1);
  }

  const imagePath = path.resolve(imagePathArg);
  const scriptPath = path.resolve(scriptPathArg);
  const outputPath =
    outArg || path.resolve(`heygen_lipsync_${Date.now()}.mp4`);

  if (!fs.existsSync(imagePath)) {
    console.error('Error: image file not found:', imagePath);
    process.exit(1);
  }
  if (!fs.existsSync(scriptPath)) {
    console.error('Error: script file not found:', scriptPath);
    process.exit(1);
  }

  try {
    // 1) Read script text (UTF-8 for Urdu)
    const scriptText = await fs.promises.readFile(scriptPath, 'utf8');

    // 2) Generate audio via ElevenLabs into a temp mp3
    const tempAudioPath = path.resolve(
      `elevenlabs_tts_${Date.now()}.mp3`
    );
    await generateElevenLabsAudioToFile(scriptText, tempAudioPath);

    // 3) Your existing HeyGen pipeline (using the generated audio file)
    const imageKey = await uploadImageAsset(imagePath);
    const groupId = await createAvatarGroup(imageKey);
    const baseTalkingPhotoId = await getBaseTalkingPhotoId(groupId);

    await waitForBasePhotoAvatarCompleted(groupId, baseTalkingPhotoId);

    const talkingPhotoWithMotionId = await addMotionToTalkingPhoto(
      baseTalkingPhotoId
    );
    await waitForTalkingPhotoReady(groupId, talkingPhotoWithMotionId);

    const audioAssetId = await uploadAudioAsset(tempAudioPath);
    const videoId = await generateVideo(talkingPhotoWithMotionId, audioAssetId);
    await waitForVideoAndDownload(videoId, outputPath);

    // Optional: cleanup temp audio
    try {
      await fs.promises.unlink(tempAudioPath);
      console.log('🧹 Deleted temp audio file:', tempAudioPath);
    } catch (e) {
      console.warn('Could not delete temp audio:', e.message);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
