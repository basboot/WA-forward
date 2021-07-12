# WA-forward

Forward all incoming Whatsapp messages to another phone, and relay replies from that other phone back to the original sender.

Uses: https://github.com/open-wa/wa-automate-nodejs

(npm/node need to be installed)
* Clone Repo
* git submodule init
* git submodule update
* npm i
* npm i -g ts-node typescript
* rename or copy config_template.ts => config.ts
* set correct remote phone number in config.ts
* ts-node index.ts
