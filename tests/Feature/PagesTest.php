<?php

namespace Tests\Feature;

use Tests\TestCase;

class PagesTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // The pages' @vite() tags need a manifest or the dev server; neither is under test here.
        $this->withoutVite();
    }

    public function test_the_game_pages_load(): void
    {
        foreach (['/', '/editor', '/lab'] as $url) {
            $this->get($url)->assertOk();
        }
    }

    public function test_old_html_urls_redirect_and_keep_the_table(): void
    {
        $this->get('/lab.html?table=draft')->assertRedirect('/lab?table=draft')->assertStatus(301);
        $this->get('/editor.html')->assertRedirect('/editor')->assertStatus(301);
    }

    public function test_pages_tell_the_frontend_whether_the_lab_is_open(): void
    {
        $this->get('/')
            ->assertSee('<script type="application/json" id="pcm-session">{"features":{"lab":true}}</script>', false)
            ->assertSee('id="link-lab"', false);
    }

    public function test_the_lab_can_be_closed_with_an_env_flag(): void
    {
        config(['pcm.lab_public' => false]);

        $this->get('/lab')->assertNotFound();
        $this->get('/')
            ->assertSee('{"features":{"lab":false}}', false)
            ->assertDontSee('id="link-lab"', false);
    }
}
