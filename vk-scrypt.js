// ========== МОЖНО МЕНЯТЬ ===========
// Задержка между добавлением песен (мс). При капче увеличьте до 5000–8000.
const SLEEP_BEFORE_NEXT_POST_REQUEST = 4500

// ============ НЕ МЕНЯТЬ ============
const VK_WEB_APP_ID = 6287487
const VK_API_VERSION_FALLBACK = "5.199"
const PLAYLIST_PAGE_SIZE = 200

// Флаг остановки: в консоли выполните stopVkAdd = true
window.stopVkAdd = false

function parsePlaylistFromUrl() {
  const url = location.href

  let match = url.match(/\/music\/playlist\/(-?\d+)_(\d+)(?:_([a-f0-9]+))?/i)
  if (match) {
    return {
      owner_id: Number(match[1]),
      playlist_id: Number(match[2]),
      access_key: match[3] || "",
    }
  }

  match = url.match(/audio_playlist(-?\d+)_(\d+)/i)
  if (match) {
    const accessMatch = url.match(/access_hash=([a-f0-9]+)/i)
      || url.match(/audio_playlist-?\d+_\d+_([a-f0-9]+)/i)

    return {
      owner_id: Number(match[1]),
      playlist_id: Number(match[2]),
      access_key: accessMatch?.[1] || "",
    }
  }

  throw new Error(
    "Откройте страницу плейлиста и запустите скрипт там.\n" +
    "Пример: https://vk.com/music/playlist/195865032_84402291_829ccc35ad28b09d51"
  )
}

function getAccessToken() {
  const directKey = `${VK_WEB_APP_ID}:web_token:login:auth`
  const raw = localStorage.getItem(directKey)

  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.access_token) {
        return parsed.access_token
      }
    } catch (_) {

    }
  }

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.endsWith(":web_token:login:auth")) {
      continue
    }

    try {
      const parsed = JSON.parse(localStorage.getItem(key))
      if (parsed?.access_token) {
        return parsed.access_token
      }
    } catch (_) {

    }
  }

  throw new Error("Не найден access_token. Обновите vk.com (F5) и войдите в аккаунт.")
}

function getApiVersion() {
  if (window.cur?.apiVersion) {
    return String(window.cur.apiVersion)
  }

  if (window.vk?.cfg?.api_version) {
    return String(window.vk.cfg.api_version)
  }

  const html = document.documentElement.innerHTML
  const match = html.match(/"apiVersion"\s*:\s*"(\d+\.\d+)"/)
  if (match) {
    return match[1]
  }

  return VK_API_VERSION_FALLBACK
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isStopped() {
  return window.stopVkAdd === true
}

function throwIfStopped() {
  if (isStopped()) {
    throw new Error("STOP")
  }
}

function getRandomNumber(min, max) {
  return Math.random() * (max - min) + min
}

function getTrackLabel(track) {
  return `${track.artist || ""} - ${track.title || ""}`.trim().toLowerCase()
}

function trackToSong(track) {
  return {
    audio_id: track.id,
    audio_owner_id: track.owner_id,
    track_code: track.track_code || "",
    access_key: track.access_key || "",
    hash: track.hash || track.add_hash || "",
    label: getTrackLabel(track),
  }
}

async function vkApiCall(method, params) {
  const response = await fetch(`https://api.vk.com/method/${method}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  })

  const data = await response.json()

  if (data.error) {
    const code = data.error.error_code
    const msg = `${data.error.error_msg} (${code})`
    const err = new Error(msg)
    err.vkErrorCode = code
    err.vkError = data.error
    throw err
  }

  return data
}

function getAjax() {
  return window.ajax || window.cur?.ajax || null
}

function vkAjaxPost(url, params) {
  return new Promise((resolve, reject) => {
    const ajax = getAjax()

    if (!ajax?.post) {
      reject(new Error("NO_AJAX"))
      return
    }

    ajax.post(url, params, {
      onDone: (response) => resolve(response),
      onFail: (code, message) => {
        const text = String(message || code || "ajax.onFail")
        const err = new Error(text)
        if (/captcha/i.test(text) || code === 14) {
          err.vkErrorCode = 14
        }
        reject(err)
      },
    })
  })
}

function buildAddPayload(song) {
  const payload = {
    act: "add",
    al: 1,
    audio_id: song.audio_id,
    audio_owner_id: song.audio_owner_id,
    oid: song.audio_owner_id,
    aid: song.audio_id,
  }

  if (song.track_code) {
    payload.track_code = song.track_code
  }

  if (song.hash) {
    payload.hash = song.hash
  }

  if (song.access_key) {
    payload.access_key = song.access_key
  }

  return payload
}

function parseAlAudioResponse(text) {
  if (/captcha/i.test(text)) {
    const err = new Error("Captcha needed (14)")
    err.vkErrorCode = 14
    throw err
  }

  if (/error_code"\s*:\s*14|"error_code":14/.test(text)) {
    const err = new Error("Captcha needed (14)")
    err.vkErrorCode = 14
    throw err
  }
}

async function addAudioViaAlAudio(song) {
  if (!song.hash && !song.track_code) {
    throw new Error("NO_AL_AUDIO_PARAMS")
  }

  const payload = buildAddPayload(song)

  try {
    return await vkAjaxPost("al_audio.php?act=add", payload)
  } catch (error) {
    if (error.message !== "NO_AJAX") {
      throw error
    }
  }

  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(payload)) {
    if (value !== "" && value !== undefined && value !== null) {
      body.set(key, String(value))
    }
  }

  const response = await fetch("/al_audio.php?act=add", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: body.toString(),
  })

  const text = await response.text()
  parseAlAudioResponse(text)
  return text
}

async function addAudioViaApi(song, accessToken, apiVersion) {
  if (!song.track_code) {
    throw new Error("У трека нет track_code")
  }

  const params = new URLSearchParams({
    audio_id: String(song.audio_id),
    owner_id: String(song.audio_owner_id),
    track_code: song.track_code,
    access_token: accessToken,
    v: apiVersion,
  })

  if (song.access_key) {
    params.set("access_key", song.access_key)
  }

  const data = await vkApiCall("audio.add", params)
  return data.response
}

async function addAudioViaVkJs(song) {
  const vkApi = window.vk?.api || window.VK?.api
  if (!vkApi) {
    throw new Error("NO_VK_JS")
  }

  return new Promise((resolve, reject) => {
    vkApi("audio.add", {
      audio_id: song.audio_id,
      owner_id: song.audio_owner_id,
      track_code: song.track_code,
      access_key: song.access_key || undefined,
    }, (response) => {
      if (response?.error) {
        const err = new Error(`${response.error.error_msg} (${response.error.error_code})`)
        err.vkErrorCode = response.error.error_code
        reject(err)
        return
      }
      resolve(response)
    })
  })
}

async function addAudioToLibrary(song, accessToken, apiVersion) {

  try {
    return await addAudioViaVkJs(song)
  } catch (error) {
    if (error.message !== "NO_VK_JS" && error.vkErrorCode !== 14) {
      console.warn("vk.api:", error.message)
    }
    if (error.vkErrorCode === 14) {
      throw error
    }
  }

  try {
    return await addAudioViaApi(song, accessToken, apiVersion)
  } catch (error) {
    if (error.vkErrorCode === 14) {
      throw error
    }
    console.warn("api.vk.com:", error.message)
  }

  return await addAudioViaAlAudio(song)
}

async function enrichTracksWithMetadata(tracks, accessToken, apiVersion) {
  const needEnrich = tracks.filter((track) => !track.track_code)
  if (needEnrich.length === 0) {
    return tracks
  }

  console.log(`Добираем track_code для ${needEnrich.length} треков...`)

  for (let i = 0; i < needEnrich.length; i += 100) {
    throwIfStopped()

    const batch = needEnrich.slice(i, i + 100)
    const audios = batch.map((track) => {
      let id = `${track.owner_id}_${track.id}`
      if (track.access_key) {
        id += `_${track.access_key}`
      }
      return id
    }).join(",")

    const params = new URLSearchParams({
      audios,
      access_token: accessToken,
      v: apiVersion,
    })

    const data = await vkApiCall("audio.getById", params)
    const items = Array.isArray(data.response) ? data.response : [data.response]

    for (const item of items) {
      if (!item?.id) {
        continue
      }

      const track = tracks.find((t) => t.id === item.id && t.owner_id === item.owner_id)
      if (!track) {
        continue
      }

      if (item.track_code) {
        track.track_code = item.track_code
      }
      if (item.access_key && !track.access_key) {
        track.access_key = item.access_key
      }
      if (item.hash || item.add_hash) {
        track.hash = item.hash || item.add_hash
      }
    }

    await sleep(300)
  }

  const stillMissing = tracks.filter((track) => !track.track_code).length
  if (stillMissing > 0) {
    console.warn(`У ${stillMissing} треков нет track_code — для них добавление может не сработать`)
  }

  return tracks
}

async function waitForCaptchaSolve() {
  console.log("")
  console.log("=== КАПЧА ===")
  console.log("1. Добавьте одну любую песню вручную через кнопку «+» на сайте")
  console.log("2. Пройдите капчу, если появится")
  console.log("3. Подождите 1–2 минуты")
  console.log("")

  prompt(
    "После того, как вы вручную добавили одну песню и прошли капчу,\n" +
    "нажмите OK, чтобы скрипт продолжил (или Отмена — остановить)."
  )
}

async function fetchAllPlaylistTracks(playlist, accessToken, apiVersion) {
  const allTracks = []
  let offset = 0
  let totalCount = null

  while (true) {
    throwIfStopped()

    const params = new URLSearchParams({
      owner_id: String(playlist.owner_id),
      album_id: String(playlist.playlist_id),
      offset: String(offset),
      count: String(PLAYLIST_PAGE_SIZE),
      access_token: accessToken,
      v: apiVersion,
    })

    if (playlist.access_key) {
      params.set("access_key", playlist.access_key)
    }

    const data = await vkApiCall("audio.get", params)
    const response = data.response

    let items
    if (Array.isArray(response)) {
      items = response
      if (totalCount === null) {
        totalCount = items.length
      }
    } else {
      items = response.items || []
      if (totalCount === null) {
        totalCount = response.count ?? items.length
      }
    }

    if (items.length === 0) {
      break
    }

    allTracks.push(...items)
    console.log(`Загружено из API: ${allTracks.length} / ${totalCount}`)

    if (allTracks.length >= totalCount) {
      break
    }

    offset += items.length
    await sleep(300)
  }

  if (allTracks.length === 0) {
    throw new Error("Плейлист пуст или API не вернул треки. Проверьте ссылку и access_key в URL.")
  }

  return allTracks
}

function askContinueFrom(songs) {
  console.log("Первый запуск? Ответьте 0 — добавить все треки с нуля.")
  console.log("Ответ 1 — только если прерывали скрипт и нужно продолжить с середины.")

  if (songs.length > 0) {
    console.log(`Следующая к добавлению: "${songs[0].label}"`)
  }

  const needToContinue = parseInt(
    prompt("Продолжить с конкретной песни?\n0 = добавить всё с начала\n1 = продолжить с середины", "0")
  )

  if (!needToContinue) {
    return songs
  }

  let inputSongName = prompt(
    "Введите часть названия следующей необработанной песни\n" +
    "(скопируйте из строки «Следующая к добавлению» выше)"
  )

  if (inputSongName === undefined || inputSongName === null) {
    throw new Error("Отменено")
  }

  inputSongName = inputSongName.trim().toLowerCase()

  if (!inputSongName) {
    throw new Error("Пустой ввод. Если начинаете с нуля — перезапустите и ответьте 0 на первый вопрос.")
  }

  const index = songs.findIndex((song) => song.label.includes(inputSongName))

  if (index === -1) {
    console.log("Не найдено. Первые песни в очереди:")
    songs.slice(0, 5).forEach((song, i) => console.log(`  ${i + 1}. ${song.label}`))
    throw new Error("Песня не найдена в плейлисте")
  }

  const remaining = songs.slice(index)

  if (remaining.length === 0) {
    throw new Error("После фильтра не осталось треков. Проверьте название или ответьте 0 на первый вопрос.")
  }

  console.log(`Продолжаем с: "${songs[index].label}" (осталось ${remaining.length} треков)`)
  return remaining
}

async function main() {
  const playlist = parsePlaylistFromUrl()
  const apiVersion = getApiVersion()

  console.log("Плейлист:", playlist)
  console.log(getAjax()?.post ? "ajax.post: доступен" : "ajax.post: нет, будет fetch → al_audio.php")
  console.log("Загружаем полный список треков через API...")

  let accessToken = getAccessToken()
  let tracks = await fetchAllPlaylistTracks(playlist, accessToken, apiVersion)
  tracks = await enrichTracksWithMetadata(tracks, accessToken, apiVersion)

  let songs = tracks.map(trackToSong)
  songs.reverse()

  if (songs[0]) {
    console.log("Пример первого трека:", {
      label: songs[0].label,
      track_code: songs[0].track_code ? "есть" : "НЕТ",
      access_key: songs[0].access_key ? "есть" : "нет",
    })
  }

  console.log(`В плейлисте ${songs.length} треков `)

  songs = askContinueFrom(songs)

  if (songs.length === 0) {
    console.log("Нечего добавлять. Перезапустите скрипт и на первый вопрос ответьте 0.")
    return
  }

  console.log(`ДОБАВЛЕНИЕ ПЕСЕН НАЧАТО (${songs.length} шт.), не закрывайте вкладку`)
  console.log("Остановка скрипта: stopVkAdd = true")

  let added = 0
  let failed = 0
  let captchaRetries = 0

  for (let i = 0; i < songs.length; i++) {
    throwIfStopped()

    try {
      accessToken = getAccessToken()
      await addAudioToLibrary(songs[i], accessToken, apiVersion)
      added++
      captchaRetries = 0
      console.log(`[${i + 1}/${songs.length}] добавлено — ${songs[i].label}`)
    } catch (error) {
      if (error.message === "STOP") {
        console.log(`ОСТАНОВЛЕНО. Успешно: ${added}, ошибок: ${failed}, осталось: ${songs.length - i}`)
        return
      }

      if (error.vkErrorCode === 14 && captchaRetries < 2) {
        captchaRetries++
        await waitForCaptchaSolve()
        i--
        continue
      }

      failed++
      console.error(`[${i + 1}/${songs.length}] ошибка:`, error.message)

      if (error.vkErrorCode === 14) {
        console.log("Капча снова. Подождите несколько часов или добавляйте вручную небольшими порциями.")
        return
      }
    }

    await sleep(SLEEP_BEFORE_NEXT_POST_REQUEST + getRandomNumber(500, 1500))
  }

  console.log(`ДОБАВЛЕНИЕ ЗАВЕРШЕНО. Успешно: ${added}, ошибок: ${failed}`)
}

await main()
