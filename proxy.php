<?php
// HX3D proxy: API key disimpan di server, bukan di browser. Di UI: Base URL = "proxy.php".
// Env (atau edit konstanta di bawah): HX_KEY (wajib), HX_TOKEN (disarankan, samain dgn "Access token" di UI),
// HX_UP (upstream, default OpenAI), HX_MODELS (allowlist model, koma), HX_RATE (maks request/menit/IP, default 20).
$UP    = getenv('HX_UP')    ?: 'https://api.openai.com/v1/chat/completions';
$KEY   = getenv('HX_KEY')   ?: 'ISI_KEY_DISINI';
$TOKEN = getenv('HX_TOKEN') ?: '';
$RATE  = (int)(getenv('HX_RATE') ?: 20);
$MODELS = array_values(array_filter(array_map('trim', explode(',', getenv('HX_MODELS') ?: ''))));
$MAX = 6 * 1024 * 1024; // batas body (screenshot base64 lumayan besar)

header('Content-Type: application/json');
function fail($c, $m, $h = null) { if ($h) header($h); http_response_code($c); echo json_encode(['error' => ['message' => $m]]); exit; }

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'POST only');

// auth: token kalau diset; kalau tidak, minimal harus same-origin (cegah situs lain numpang key lu)
if ($TOKEN !== '') {
  if (!hash_equals($TOKEN, $_SERVER['HTTP_X_HX_TOKEN'] ?? '')) fail(401, 'token salah');
} else {
  $o = parse_url($_SERVER['HTTP_ORIGIN'] ?? '', PHP_URL_HOST);
  $h = preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? '');
  if (!$o || strcasecmp($o, $h) !== 0) fail(403, 'origin tidak diizinkan (set HX_TOKEN biar aman)');
}

// rate limit per IP (file di tmp)
if ($RATE > 0) {
  $fp = fopen(sys_get_temp_dir() . '/hx_rl_' . md5($_SERVER['REMOTE_ADDR'] ?? 'x'), 'c+');
  if ($fp && flock($fp, LOCK_EX)) {
    $now = time();
    $t = array_values(array_filter(array_map('intval', explode(',', stream_get_contents($fp))), function ($x) use ($now) { return $x > $now - 60; }));
    if (count($t) >= $RATE) fail(429, 'terlalu banyak request, tunggu sebentar', 'Retry-After: 10');
    $t[] = $now; ftruncate($fp, 0); rewind($fp); fwrite($fp, implode(',', $t)); flock($fp, LOCK_UN); fclose($fp);
  }
}

$in = file_get_contents('php://input', false, null, 0, $MAX + 1);
if (strlen($in) > $MAX) fail(413, 'body terlalu besar');
$j = json_decode($in, true);
if (!is_array($j)) fail(400, 'JSON tidak valid');
if ($MODELS && !in_array($j['model'] ?? '', $MODELS, true)) fail(403, 'model tidak diizinkan');
unset($j['stream']); // proxy ini non-streaming

$ch = curl_init($UP);
curl_setopt_array($ch, [
  CURLOPT_POST => 1, CURLOPT_POSTFIELDS => json_encode($j),
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $KEY],
  CURLOPT_RETURNTRANSFER => 1, CURLOPT_TIMEOUT => 180, CURLOPT_CONNECTTIMEOUT => 15,
]);
$r = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE) ?: 502;
if ($r === false) fail(502, 'upstream error: ' . curl_error($ch));
http_response_code($code);
echo $r;
