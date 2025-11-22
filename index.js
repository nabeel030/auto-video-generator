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

function log(msg) {
  console.log(msg);
  const panel = document.getElementById('logPanel');
  if (!panel) return;
  const timestamp = new Date().toLocaleTimeString();
  panel.textContent += `[${timestamp}] ${msg}\n`;
  panel.scrollTop = panel.scrollHeight;
}

function setStatus(msg, type = '') {
  const statusEl = document.getElementById('status');
  statusEl.textContent = msg;
  statusEl.className = 'status';
  if (type === 'error') statusEl.classList.add('status--error');
  if (type === 'success') statusEl.classList.add('status--success');
  log(msg);
}

function setProgress(percent) {
  const bar = document.getElementById('progressBar');
  if (!bar) return;
  const p = Math.max(0, Math.min(100, percent));
  bar.style.width = `${p}%`;
}

// -------------- ElevenLabs: TTS -> Blob --------------

async function generateElevenLabsAudioBlob({
  elevenKey,
  voiceId,
  modelId,
  text,
}) {
  log('▶ Calling ElevenLabs TTS…');

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    voiceId
  )}`;

  const body = {
    text,
    model_id: modelId,
    voice_settings: {
      stability: 0.30,
      similarity_boost: 0.85,
      style: 0.45,
      use_speaker_boost: true,
      // 🔽 tweak this if you want slower / faster speech
      speed: 0.85,
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
  log(`✔ ElevenLabs audio generated (blob size: ${blob.size})`);
  return blob;
}

// -------------- HeyGen: Upload asset (image/audio) --------------

async function uploadHeygenAsset({ heygenKey, file, fallbackType }) {
  const url = 'https://upload.heygen.com/v1/asset';

  const contentType =
    file.type || guessContentType(file.name || 'file', fallbackType);

  log(`▶ Uploading HeyGen asset: ${file.name || '(blob)'} (${contentType})`);

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
    throw new Error(
      'HeyGen upload did not return an asset id: ' + JSON.stringify(json)
    );
  }

  log(`✔ HeyGen asset uploaded. id: ${id}`);
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
  log('▶ Creating HeyGen photo avatar group…');

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

  log(`✔ Avatar group created. group_id: ${groupId}`);
  return groupId;
}

async function getAvatarList(heygenKey, groupId) {
  const url = `https://api.heygen.com/v2/avatar_group/${encodeURIComponent(
    groupId
  )}/avatars`;

  const res = await heygenJsonFetch(url, { method: 'GET' }, heygenKey);
  return res.data?.avatar_list || [];
}

async function getBaseTalkingPhotoId(heygenKey, groupId) {
  log(`▶ Fetching avatar list for group: ${groupId}`);

  const list = await getAvatarList(heygenKey, groupId);

  if (!list.length) {
    throw new Error('Avatar list empty for group: ' + groupId);
  }

  const id = list[0].id;
  if (!id) {
    throw new Error('Avatar has no id: ' + JSON.stringify(list[0]));
  }

  log(`✔ Base talking photo id: ${id}`);
  return id;
}

async function waitForBasePhotoAvatarCompleted(
  heygenKey,
  groupId,
  avatarId,
  { intervalMs = 5000, maxAttempts = 60 } = {}
) {
  log('▶ Waiting for base photo avatar to complete…');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const list = await getAvatarList(heygenKey, groupId);
    const found = list.find((av) => av.id === avatarId);
    const status = found?.status;

    log(`  Attempt ${attempt}: base avatar status = ${status || 'unknown'}`);

    if (status === 'completed') {
      log('✔ Base photo avatar completed.');
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
  log(`▶ Adding motion to talking photo: ${talkingPhotoId}`);

  const payload = {
    id: talkingPhotoId,
    motion_type: 'runway_gen4', // or 'runway_gen4' to experiment
    // prompt: "Talk naturally with a warm, friendly tone while keeping steady eye contact with the viewer; use smooth facial expressions and soft, no blinks at all; if hands are visible, move them gently with small, relaxed gestures; keep head movements minimal and smooth without sudden or jerky motions."
    prompt: "Talk naturally with a warm, friendly tone while keeping steady eye contact with the viewer; use smooth facial expressions and soft, irregular blinks; if hands are visible, move them gently with small, relaxed gestures; keep head movements minimal and smooth without sudden or jerky motions."
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

  log(`✔ Motion added. talking_photo_with_motion_id: ${motionId}`);
  return motionId;
}

async function waitForTalkingPhotoReady(
  heygenKey,
  groupId,
  talkingPhotoId,
  { intervalMs = 5000, maxAttempts = 60 } = {}
) {
  log('▶ Waiting for talking photo with motion to be ready…');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const list = await getAvatarList(heygenKey, groupId);
    const found = list.find((av) => av.id === talkingPhotoId);
    const status = found?.status;

    log(`  Attempt ${attempt}: status = ${status || 'unknown'}`);

    if (status === 'completed') {
      log('✔ Talking photo is ready with motion.');
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
  log('▶ Generating video from talking photo + audio…');

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

  log(`✔ Video generation started. video_id: ${videoId}`);
  return videoId;
}

async function waitForVideoAndGetUrl(heygenKey, videoId, intervalMs = 5000) {
  log('▶ Waiting for video rendering to complete…');

  // We already set progress to 90 before calling this.
  // We'll slowly move from 90 → 99 while status is processing/queued.
  let progress = 50;

  while (true) {
    try {
      const url = `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(
        videoId
      )}`;

      const res = await heygenJsonFetch(url, { method: 'GET' }, heygenKey);
      const status = res.data?.status;

      // Handle completed
      if (status === 'completed') {
        const videoUrl = res.data?.video_url;
        if (!videoUrl) {
          log('⚠ Video status is completed but no URL yet, retrying…');
          await sleep(intervalMs);
          continue;
        }

        log(`✔ Video ready. URL: ${videoUrl}`);
        setProgress(100);
        return videoUrl;
      }

      // Handle failed
      if (status === 'failed') {
        throw new Error(
          'Video generation failed: ' +
            JSON.stringify(res.data?.error || res.data)
        );
      }

      // Still processing / queued / rendering
      // Increment progress slowly up to 99% (fake visual progress)
      if (progress < 99) {
        progress += 1;
      }
      setProgress(progress);

      log(
        `  Video rendering: ${progress}% (status: ${status || 'unknown'})`
      );

      await sleep(intervalMs);
    } catch (err) {
      // Network / temporary API issue: log and retry
      log(
        `⚠ Error while checking video status: ${err.message}. Retrying in ${
          intervalMs / 1000
        }s…`
      );
      await sleep(intervalMs);
    }
  }
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

  const audioSource = document.querySelector(
    'input[name="audioSource"]:checked'
  )?.value || 'text';

  const audioFileInput = document.getElementById('audioFile');
  const uploadedAudioFile = audioFileInput.files[0];

  const remember = document.getElementById('rememberSettings').checked;

  const downloadSection = document.getElementById('downloadSection');
  const videoLink = document.getElementById('videoLink');

  downloadSection.classList.add('hidden');
  videoLink.href = '#';
  setProgress(0);

  // Remember / clear settings in localStorage
  if (remember) {
    localStorage.setItem('tg_remember', '1');
    localStorage.setItem('tg_heygenKey', heygenKey);
    localStorage.setItem('tg_elevenKey', elevenKey);
    localStorage.setItem('tg_audioSource', audioSource);
    localStorage.setItem('tg_scriptText', scriptText);
  } else {
    localStorage.removeItem('tg_remember');
    localStorage.removeItem('tg_heygenKey');
    localStorage.removeItem('tg_elevenKey');
    localStorage.removeItem('tg_audioSource');
    localStorage.removeItem('tg_scriptText');
  }

  // ---- Validation based on audio source ----
  if (!heygenKey) {
    setStatus('Please enter your HeyGen API key.', 'error');
    return;
  }

  if (!avatarFile) {
    setStatus('Please select an avatar image.', 'error');
    return;
  }

  if (audioSource === 'text') {
    if (!elevenKey) {
      setStatus(
        'Please enter your ElevenLabs API key (required when using script text).',
        'error'
      );
      return;
    }
    if (!scriptText) {
      setStatus('Please enter your script text.', 'error');
      return;
    }
  } else if (audioSource === 'mp3') {
    if (!uploadedAudioFile) {
      setStatus('Please upload an MP3 file.', 'error');
      return;
    }
  }

  const generateBtn = document.getElementById('generateBtn');
  generateBtn.disabled = true;
  setStatus('Starting generation… This can take a few minutes.', '');
  setProgress(5);

  try {
    let audioFile;

    if (audioSource === 'text') {
      // 1) ElevenLabs TTS → audio blob
      setStatus('Generating audio via ElevenLabs…');
      const audioBlob = await generateElevenLabsAudioBlob({
        elevenKey,
        voiceId: elevenVoiceId,
        modelId: elevenModelId,
        text: scriptText,
      });
      setProgress(20);

      // Turn blob into File-like object for upload
      audioFile = new File([audioBlob], `tts_${Date.now()}.mp3`, {
        type: 'audio/mpeg',
      });
    } else {
      // Use uploaded MP3 directly
      setStatus('Using uploaded MP3 audio…');
      audioFile = uploadedAudioFile;
      setProgress(15);
    }

    // 2) Upload avatar image to HeyGen
    setStatus('Uploading avatar image to HeyGen…');
    const imageKey = await uploadHeygenAsset({
      heygenKey,
      file: avatarFile,
      fallbackType: 'image/jpeg',
    });
    setProgress(30);

    // 3) Create avatar group
    setStatus('Creating talking photo avatar in HeyGen…');
    const groupId = await createAvatarGroup(heygenKey, imageKey);
    setProgress(40);

    // 4) Get base talking photo id
    const baseTalkingPhotoId = await getBaseTalkingPhotoId(heygenKey, groupId);

    // 5) Wait for base avatar to complete
    setStatus('Waiting for base avatar to be processed…');
    await waitForBasePhotoAvatarCompleted(
      heygenKey,
      groupId,
      baseTalkingPhotoId
    );
    setProgress(55);

    // 6) Add motion
    setStatus('Adding motion to avatar…');
    const talkingPhotoWithMotionId = await addMotionToTalkingPhoto(
      heygenKey,
      baseTalkingPhotoId
    );

    // 7) Wait for motion avatar ready
    setStatus('Waiting for motion avatar to be ready…');
    await waitForTalkingPhotoReady(
      heygenKey,
      groupId,
      talkingPhotoWithMotionId
    );
    setProgress(70);

    // 8) Upload audio asset
    setStatus('Uploading audio to HeyGen…');
    const audioAssetId = await uploadHeygenAsset({
      heygenKey,
      file: audioFile,
      fallbackType: 'audio/mpeg',
    });
    setProgress(80);

    // 9) Generate video
    setStatus('Requesting video generation from HeyGen…');
    const videoId = await generateHeygenVideo(
      heygenKey,
      talkingPhotoWithMotionId,
      audioAssetId
    );
    setProgress(90);

    // 10) Wait for video + get URL
    setStatus('Waiting for video to render…');
    const videoUrl = await waitForVideoAndGetUrl(heygenKey, videoId);
    setProgress(100);

    // Show link
    videoLink.href = videoUrl;
    downloadSection.classList.remove('hidden');
    setStatus('Video generated successfully!', 'success');
  } catch (err) {
    console.error(err);
    setStatus('Error: ' + err.message, 'error');
    setProgress(0);
  } finally {
    generateBtn.disabled = false;
  }
}

// -------------- UI toggle for audio source --------------

function updateAudioSourceUI() {
  const audioSource = document.querySelector(
    'input[name="audioSource"]:checked'
  )?.value || 'text';

  const scriptGroup = document.getElementById('scriptGroup');
  const audioFileGroup = document.getElementById('audioFileGroup');
  const elevenKeyGroup = document.getElementById('elevenKeyGroup');

  if (audioSource === 'text') {
    scriptGroup.classList.remove('hidden');
    elevenKeyGroup.classList.remove('hidden');
    audioFileGroup.classList.add('hidden');
  } else {
    scriptGroup.classList.add('hidden');
    elevenKeyGroup.classList.add('hidden');
    audioFileGroup.classList.remove('hidden');
  }
}

// -------------- Load saved settings --------------

function loadSavedSettings() {
  const remember = localStorage.getItem('tg_remember') === '1';
  const rememberCheckbox = document.getElementById('rememberSettings');
  rememberCheckbox.checked = remember;

  if (!remember) return;

  const savedHeygenKey = localStorage.getItem('tg_heygenKey') || '';
  const savedElevenKey = localStorage.getItem('tg_elevenKey') || '';
  const savedAudioSource = localStorage.getItem('tg_audioSource') || 'text';
  const savedScriptText = localStorage.getItem('tg_scriptText') || '';

  document.getElementById('heygenKey').value = savedHeygenKey;
  document.getElementById('elevenKey').value = savedElevenKey;
  document.getElementById('scriptText').value = savedScriptText;

  const radio = document.querySelector(
    `input[name="audioSource"][value="${savedAudioSource}"]`
  );
  if (radio) {
    radio.checked = true;
  }
}

// -------------- Wire up form --------------

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('generatorForm');
  form.addEventListener('submit', handleGenerate);

  const audioSourceRadios = document.querySelectorAll(
    'input[name="audioSource"]'
  );
  audioSourceRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      updateAudioSourceUI();
      const audioSource = document.querySelector(
        'input[name="audioSource"]:checked'
      )?.value || 'text';
      const remember = document.getElementById('rememberSettings').checked;
      if (remember) {
        localStorage.setItem('tg_audioSource', audioSource);
      }
    });
  });

  loadSavedSettings();
  updateAudioSourceUI();
  log('✅ UI ready.');
});
