// index.js (browser-side, no Node APIs)

// -------------- Small helpers --------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function guessContentType(fileName, fallback) {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'm4a') return 'audio/mp4';
  return fallback || 'application/octet-stream';
}

function setStatus(msg, type = '') {
  const statusEl = document.getElementById('status');
  statusEl.textContent = msg;
  statusEl.className = 'status';
  if (type === 'error') statusEl.classList.add('status--error');
  if (type === 'success') statusEl.classList.add('status--success');
}

// -------------- ElevenLabs: TTS -> Blob --------------

async function generateElevenLabsAudioBlob({
  elevenKey,
  voiceId,
  modelId,
  text,
}) {
  console.log('▶ Calling ElevenLabs TTS…');

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    voiceId
  )}`;

  const body = {
    text,
    model_id: modelId,
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
      'xi-api-key': elevenKey,
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

  const blob = await res.blob();
  console.log('✔ ElevenLabs audio generated (blob size:', blob.size, ')');
  return blob;
}

// -------------- HeyGen: Upload asset (image/audio) --------------

async function uploadHeygenAsset({ heygenKey, file, fallbackType }) {
  const url = 'https://upload.heygen.com/v1/asset';

  const contentType =
    file.type || guessContentType(file.name || 'file', fallbackType);

  console.log('▶ Uploading HeyGen asset:', file.name || '(blob)', contentType);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'X-Api-Key': heygenKey,
    },
    body: file,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `HeyGen upload failed. HTTP ${res.status}: ${JSON.stringify(json)}`
    );
  }

  const data = json.data || {};
  const id =
    data.image_key || data.id || data.asset_id || data.audio_asset_id || null;

  if (!id) {
    throw new Error('HeyGen upload did not return an asset id: ' + JSON.stringify(json));
  }

  console.log('✔ HeyGen asset uploaded. id:', id);
  return id;
}

// -------------- HeyGen: JSON helper --------------

async function heygenJsonFetch(url, options = {}, heygenKey) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Api-Key': heygenKey,
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

// -------------- HeyGen: Create avatar group --------------

async function createAvatarGroup(heygenKey, imageKey) {
  console.log('▶ Creating HeyGen photo avatar group…');

  const payload = {
    name: 'Generated Talking Photo (Browser)',
    image_key: imageKey,
  };

  const res = await heygenJsonFetch(
    'https://api.heygen.com/v2/photo_avatar/avatar_group/create',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    heygenKey
  );

  const groupId = res.data?.group_id;
  if (!groupId) {
    throw new Error(
      'No group_id in avatar_group.create response: ' + JSON.stringify(res)
    );
  }

  console.log('✔ Avatar group created. group_id:', groupId);
  return groupId;
}

async function getAvatarList(heygenKey, groupId) {
  const url = `https://api.heygen.com/v2/avatar_group/${encodeURIComponent(
    groupId
  )}/avatars`;

  const res = await heygenJsonFetch(
    url,
    { method: 'GET' },
    heygenKey
  );

  return res.data?.avatar_list || [];
}

async function getBaseTalkingPhotoId(heygenKey, groupId) {
  console.log('▶ Fetching avatar list for group:', groupId);

  const list = await getAvatarList(heygenKey, groupId);

  if (!list.length) {
    throw new Error('Avatar list empty for group: ' + groupId);
  }

  const id = list[0].id;
  if (!id) {
    throw new Error('Avatar has no id: ' + JSON.stringify(list[0]));
  }

  console.log('✔ Base talking photo id:', id);
  return id;
}

async function waitForBasePhotoAvatarCompleted(
  heygenKey,
  groupId,
  avatarId,
  { intervalMs = 5000, maxAttempts = 60 } = {}
) {
  console.log('▶ Waiting for base photo avatar to complete…');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const list = await getAvatarList(heygenKey, groupId);
    const found = list.find((av) => av.id === avatarId);
    const status = found?.status;

    console.log(
      `  Attempt ${attempt}: base avatar status = ${status || 'unknown'}`
    );

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

// -------------- HeyGen: Add motion & wait --------------

async function addMotionToTalkingPhoto(heygenKey, talkingPhotoId) {
  console.log('▶ Adding motion to talking photo:', talkingPhotoId);

  const payload = {
    id: talkingPhotoId,
    prompt:
      'Speak in a calm, friendly manner with subtle eye movement and small, natural head motions. Avoid exaggerated blinking or fast head movements.',
    motion_type: 'consistent',
  };

  const res = await heygenJsonFetch(
    'https://api.heygen.com/v2/photo_avatar/add_motion',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    heygenKey
  );

  const motionId = res.data?.id;
  if (!motionId) {
    throw new Error(
      'No motion id returned from add_motion: ' + JSON.stringify(res)
    );
  }

  console.log('✔ Motion added. talking_photo_with_motion_id:', motionId);
  return motionId;
}

async function waitForTalkingPhotoReady(
  heygenKey,
  groupId,
  talkingPhotoId,
  { intervalMs = 5000, maxAttempts = 60 } = {}
) {
  console.log('▶ Waiting for talking photo with motion to be ready…');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const list = await getAvatarList(heygenKey, groupId);
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

// -------------- HeyGen: Video generation & status --------------

async function generateHeygenVideo(heygenKey, talkingPhotoId, audioAssetId) {
  console.log('▶ Generating video from talking photo + audio…');

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
          audio_config: {
            speaking_rate: 1.0,
            volume_gain_db: 0.0,
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
    caption_config: {
      enabled: false,
    },
  };

  const res = await heygenJsonFetch(
    'https://api.heygen.com/v2/video/generate',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    heygenKey
  );

  const videoId = res.data?.video_id;
  if (!videoId) {
    throw new Error(
      'No video_id in video.generate response: ' + JSON.stringify(res)
    );
  }

  console.log('✔ Video generation started. video_id:', videoId);
  return videoId;
}

async function waitForVideoAndGetUrl(
  heygenKey,
  videoId,
  { intervalMs = 5000, maxAttempts = 60 } = {}
) {
  console.log('▶ Waiting for video rendering to complete…');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const url = `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(
      videoId
    )}`;

    const res = await heygenJsonFetch(url, { method: 'GET' }, heygenKey);
    const status = res.data?.status;

    console.log(`  Attempt ${attempt}: video status = ${status}`);

    if (status === 'completed') {
      const videoUrl = res.data?.video_url;
      if (!videoUrl) {
        throw new Error(
          'Video completed but video_url missing: ' + JSON.stringify(res)
        );
      }

      console.log('✔ Video ready. URL:', videoUrl);
      return videoUrl;
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

// -------------- Main generate flow (browser) --------------

async function handleGenerate(event) {
  event.preventDefault();

  const elevenKey = document.getElementById('elevenKey').value.trim();
  const elevenVoiceId = 'cgSgspJ2msm6clMCkdW9';
  const elevenModelId = 'eleven_multilingual_v2';
  const heygenKey = document.getElementById('heygenKey').value.trim();
  const scriptText = document.getElementById('scriptText').value.trim();
  const avatarInput = document.getElementById('avatarFile');
  const avatarFile = avatarInput.files[0];

  const downloadSection = document.getElementById('downloadSection');
  const videoLink = document.getElementById('videoLink');

  downloadSection.classList.add('hidden');
  videoLink.href = '#';

  if (!elevenKey || !heygenKey || !scriptText || !avatarFile) {
    setStatus('Please fill all fields and select an avatar image.', 'error');
    return;
  }

  const generateBtn = document.getElementById('generateBtn');
  generateBtn.disabled = true;
  setStatus('Starting generation… This can take 1–3 minutes.', '');

  try {
    // 1) ElevenLabs TTS → audio blob
    setStatus('Generating audio via ElevenLabs…');
    const audioBlob = await generateElevenLabsAudioBlob({
      elevenKey,
      voiceId: elevenVoiceId,
      modelId: elevenModelId,
      text: scriptText,
    });

    // Turn blob into File-like object for upload
    const audioFile = new File(
      [audioBlob],
      `tts_${Date.now()}.mp3`,
      { type: 'audio/mpeg' }
    );

    // 2) Upload avatar image to HeyGen
    setStatus('Uploading avatar image to HeyGen…');
    const imageKey = await uploadHeygenAsset({
      heygenKey,
      file: avatarFile,
      fallbackType: 'image/jpeg',
    });

    // 3) Create avatar group
    setStatus('Creating talking photo avatar in HeyGen…');
    const groupId = await createAvatarGroup(heygenKey, imageKey);

    // 4) Get base talking photo id
    const baseTalkingPhotoId = await getBaseTalkingPhotoId(heygenKey, groupId);

    // 5) Wait for base avatar to complete
    setStatus('Waiting for base avatar to be processed…');
    await waitForBasePhotoAvatarCompleted(heygenKey, groupId, baseTalkingPhotoId);

    // 6) Add motion
    setStatus('Adding motion to avatar…');
    const talkingPhotoWithMotionId = await addMotionToTalkingPhoto(
      heygenKey,
      baseTalkingPhotoId
    );

    // 7) Wait for motion avatar ready
    setStatus('Waiting for motion avatar to be ready…');
    await waitForTalkingPhotoReady(heygenKey, groupId, talkingPhotoWithMotionId);

    // 8) Upload audio asset
    setStatus('Uploading audio to HeyGen…');
    const audioAssetId = await uploadHeygenAsset({
      heygenKey,
      file: audioFile,
      fallbackType: 'audio/mpeg',
    });

    // 9) Generate video
    setStatus('Requesting video generation from HeyGen…');
    const videoId = await generateHeygenVideo(
      heygenKey,
      talkingPhotoWithMotionId,
      audioAssetId
    );

    // 10) Wait for video + get URL
    setStatus('Waiting for video to render…');
    const videoUrl = await waitForVideoAndGetUrl(heygenKey, videoId);

    // Show link
    videoLink.href = videoUrl;
    downloadSection.classList.remove('hidden');
    setStatus('Video generated successfully!', 'success');

  } catch (err) {
    console.error(err);
    setStatus('Error: ' + err.message, 'error');
  } finally {
    generateBtn.disabled = false;
  }
}

// -------------- Wire up form --------------

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('generatorForm');
  form.addEventListener('submit', handleGenerate);
});
