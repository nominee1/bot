<?php
require __DIR__ . '/config.php';

/**
 * SSE hardening:
 * - Disable buffering + compression so flush() actually sends bytes
 * - Set headers to stop proxy buffering (X-Accel-Buffering: no)
 * - Send retry: to control client reconnect interval
 * - Heartbeat every 15s to keep the pipe alive
 * - Poll the file every 2s and push only on changes
 */

@ini_set('zlib.output_compression', '0');
@ini_set('output_buffering', 'off');
@ini_set('implicit_flush', '1');
while (@ob_end_flush()) {} // empty all output buffers

// CORS (no credentials for EventSource)
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed_origins ?? [], true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
}

// SSE headers
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Connection: keep-alive');
header('X-Accel-Buffering: no'); // Nginx: disable proxy buffering

ignore_user_abort(true);
// Avoid request timeouts if your host allows it
@set_time_limit(0);

/** Small helpers */
function read_status($file) {
    if (!file_exists($file)) {
        return ['status'=>'ok','updated_at'=>gmdate('c')];
    }
    $raw = @file_get_contents($file);
    $data = json_decode($raw ?: '', true);
    if (!is_array($data) || !isset($data['status'])) {
        return ['status'=>'ok','updated_at'=>gmdate('c')];
    }
    return $data;
}

$last_sent = '';
// Tell browser how quickly to reconnect if disconnected
echo "retry: 10000\n\n"; // 10s
@ob_flush(); flush();

$beat_at = 0;

while (true) {
    // 1) Push when data changes
    $data = read_status($STORE_FILE);
    $current = json_encode($data, JSON_UNESCAPED_SLASHES);
    if ($current !== $last_sent) {
        echo "event: status\n";
        echo "data: $current\n\n";
        @ob_flush(); flush();
        $last_sent = $current;
        $beat_at = 0; // reset heartbeat so next one is in ~15s
    }

    // 2) Heartbeat every ~15s to keep the connection alive
    $beat_at++;
    if ($beat_at >= 8) { // 8 * 2s ≈ 16s
        echo "event: ping\ndata: {}\n\n";
        @ob_flush(); flush();
        $beat_at = 0;
    }

    if (connection_aborted()) break;
    sleep(2);
}
