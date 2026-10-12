<?php
/**
 * Plugin Name: AI Growth OS Structured Data Adapter
 * Description: Registers and safely renders reviewed AI Growth OS JSON-LD for WordPress posts and pages.
 * Version: 1.0.0
 * Requires PHP: 8.0
 */

if (!defined('ABSPATH')) {
    exit;
}

function aigrowthos_schema_value($value, $post_id = 0) {
    if (!is_array($value)) {
        return new WP_Error('aigrowthos_schema_invalid', 'Structured data must be an object.');
    }

    $allowed = array('@context', '@type', 'name', 'url', 'description', 'headline');
    if (array_diff(array_keys($value), $allowed)) {
        return new WP_Error('aigrowthos_schema_invalid', 'Unsupported structured data fields.');
    }

    if (($value['@context'] ?? null) !== 'https://schema.org'
        || !in_array(($value['@type'] ?? null), array('Organization', 'WebPage', 'Article'), true)
        || !is_string($value['name'] ?? null)
        || strlen(trim($value['name'])) < 2
        || strlen($value['name']) > 200
        || !is_string($value['url'] ?? null)
    ) {
        return new WP_Error('aigrowthos_schema_invalid', 'Required structured data fields are invalid.');
    }

    $url = wp_parse_url($value['url']);
    $home = wp_parse_url(home_url('/'));
    if (!is_array($url)
        || !in_array($url['scheme'] ?? '', array('http', 'https'), true)
        || empty($url['host'])
        || strtolower($url['host']) !== strtolower($home['host'] ?? '')
        || isset($url['user'])
        || isset($url['pass'])
    ) {
        return new WP_Error('aigrowthos_schema_invalid', 'Structured data URL must belong to this WordPress site.');
    }

    if (isset($value['description']) && (!is_string($value['description']) || strlen($value['description']) > 2000)) {
        return new WP_Error('aigrowthos_schema_invalid', 'Description is invalid.');
    }

    if (($value['@type'] ?? null) === 'Article'
        && (!is_string($value['headline'] ?? null) || strlen(trim($value['headline'])) < 2 || strlen($value['headline']) > 200)
    ) {
        return new WP_Error('aigrowthos_schema_invalid', 'Articles require a valid headline.');
    }

    $clean = array(
        '@context' => 'https://schema.org',
        '@type' => $value['@type'],
        'name' => trim($value['name']),
        'url' => esc_url_raw($value['url']),
    );
    foreach (array('description', 'headline') as $field) {
        if (isset($value[$field])) {
            $clean[$field] = sanitize_text_field($value[$field]);
        }
    }
    return $clean;
}

function aigrowthos_schema_auth($allowed, $meta_key, $post_id) {
    return $post_id
        && current_user_can('edit_post', $post_id)
        && current_user_can('edit_post_meta', $post_id, 'aigrowthos_jsonld');
}

function aigrowthos_register_schema_meta() {
    $args = array(
        'single' => true,
        'type' => 'object',
        'show_in_rest' => array(
            'schema' => array(
                'type' => 'object',
                'additionalProperties' => false,
                'properties' => array(
                    '@context' => array('type' => 'string'),
                    '@type' => array('type' => 'string'),
                    'name' => array('type' => 'string'),
                    'url' => array('type' => 'string'),
                    'description' => array('type' => 'string'),
                    'headline' => array('type' => 'string'),
                ),
            ),
        ),
        'auth_callback' => 'aigrowthos_schema_auth',
        'sanitize_callback' => 'aigrowthos_schema_value',
        'default' => null,
    );
    register_post_meta('post', 'aigrowthos_jsonld', $args);
    register_post_meta('page', 'aigrowthos_jsonld', $args);
}
add_action('init', 'aigrowthos_register_schema_meta');

function aigrowthos_render_schema_meta() {
    if (!is_singular(array('post', 'page'))) {
        return;
    }

    $post_id = get_queried_object_id();
    $value = get_post_meta($post_id, 'aigrowthos_jsonld', true);
    if (!$value) {
        return;
    }

    $validated = aigrowthos_schema_value($value, $post_id);
    if (is_wp_error($validated)) {
        return;
    }

    $json = wp_json_encode($validated, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    if (!is_string($json)) {
        return;
    }

    echo "\n<script type=\"application/ld+json\">" . $json . "</script>\n";
}
add_action('wp_head', 'aigrowthos_render_schema_meta', 30);
