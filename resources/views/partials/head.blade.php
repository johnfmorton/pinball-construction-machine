<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{{ $title }}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Ccircle cx=%2216%22 cy=%2216%22 r=%2213%22 fill=%22%23c8ced6%22 stroke=%22%235d6670%22 stroke-width=%222%22/%3E%3Ccircle cx=%2212%22 cy=%2211%22 r=%224%22 fill=%22%23fff%22/%3E%3C/svg%3E" />
{{-- Read by src/shared/session.ts, so pages need no request on load to know this. --}}
<script type="application/json" id="pcm-session">@json(['features' => ['lab' => (bool) config('pcm.lab_public')]])</script>
