<?php
// Admin-only: support chat with users (see supabase/chat.sql). Users send
// messages directly to Supabase (RLS-scoped to their own row); the admin
// panel goes through here with the service role so it can see every
// conversation and reply as 'admin'.

require_once __DIR__ . '/_utils.php';

if (apply_cors()) exit;
require_post();

if (!verify_admin_token()) {
    send_json(401, ['error' => 'Unauthorized']);
}

if (!supabase_configured()) {
    send_json(500, ['error' => 'Server is missing SUPABASE_SERVICE_ROLE_KEY configuration.']);
}

$body = json_body();
$action = $body['action'] ?? null;
$userId = $body['userId'] ?? null;

if ($action === 'conversations') {
    [$data, $error] = supabase_rpc('admin_list_chats', []);
    if ($error) send_json(500, ['error' => $error]);
    send_json(200, ['conversations' => $data ?: []]);
}

if ($action === 'messages') {
    if (!$userId) send_json(400, ['error' => 'Missing userId.']);
    $rows = supabase_select('chat_messages', [
        'user_id' => 'eq.' . $userId,
        'order' => 'created_at.asc',
    ]);
    supabase_update('chat_messages', [
        'user_id' => 'eq.' . $userId,
        'sender' => 'eq.user',
        'read_by_admin' => 'eq.false',
    ], ['read_by_admin' => true]);
    send_json(200, ['messages' => $rows ?: []]);
}

if ($action === 'send') {
    $text = trim($body['body'] ?? '');
    if (!$userId || !$text) send_json(400, ['error' => 'Missing userId or message body.']);
    [$data, $error] = supabase_insert_returning('chat_messages', [
        'user_id' => $userId,
        'sender' => 'admin',
        'body' => $text,
        'read_by_admin' => true,
        'read_by_user' => false,
    ]);
    if ($error) send_json(500, ['error' => $error]);
    send_json(200, ['message' => $data]);
}

send_json(400, ['error' => 'Unknown action.']);
