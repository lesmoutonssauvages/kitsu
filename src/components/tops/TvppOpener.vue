<template>
  <div class="menu-item" style="text-align: center; line-height: 1em;" v-if="taskId && link">
    <small>open</small>
    <br />
    <strong><a :href="link">TVPP</a></strong>
  </div>
</template>
<script>
import superagent from 'superagent'
export default {
  name: 'tvpp-opener',
  props: {
    taskId: {
      type: String
    }
  },
  data() {
    return {
      link: ''
    }
  },
  watch: {
    async taskId () {
      try {
        const tld = document.location.host.split('.')
        if (!tld) return
        const ext = tld.pop() === 'tv' ? 'tv' : 'local'
        const p = await superagent
          .get(`https://api.tools.eddystudio.${ext}/projects/${this.$route.params.production_id}/tasks/${this.taskId}/file`)
          .set('X-Tenant-Id', 'lecorset-zou-app')
        /*
        const p = await fetch(
          `https://api.tools.eddystudio.${ext}/projects/${this.$route.params.production_id}/tasks/${this.taskId}/file`, {
            headers: {
              'X-Tenant-Id': 'lecorset-zou-app',
              // @ts-ignore
              'Authorization': `Bearer ${access_token}`
            }
          }
        )
        */
        if (!p.ok) return
        this.link = await p.text()
      } catch(error) {
        console.log(error)
      }
    }
  }
}
</script>