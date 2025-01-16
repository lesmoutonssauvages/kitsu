<template>
  <div class="menu-item" style="text-align: center; line-height: 1em;" v-if="taskId && link && selectedTaskIds.length === 1">
    <a :href="link">
      <small>open</small>
      <br />
      <strong>{{ extension }}</strong>
    </a>
  </div>
</template>
<script>
export default {
  name: 'tvpp-opener',
  props: {
    selectedTaskIds: {
      type: Array
    },
    personId: {
      type: String
    },
    productionId: {
      type: String,
      default () {
        return this.$route.params.production_id
      }
    },
    partner: {
      type: Object
    }
  },
  data() {
    return {
      link: ''
    }
  },
  computed: {
    taskId() {
      return this.selectedTaskIds[0]
    },
    extension() {
      return this.link.split('.')?.pop()
    }
  },
  watch: {
    taskId: {
      async handler(newVal) {
        this.link = ''
        try {
          if (!this.taskId) return
          const tld = document.location.host.split('.')
          const ext = tld.pop() === 'tv' ? 'tv' : 'local'
          let [,tenant] = tld
          // Local case in kitsu.dev mode (127.0.0.1)
          if (tenant === '0' && ext === 'local') {
            tenant = 'corset'
          }
          let url = `https://api.tools.eddystudio.${ext}/projects/${this.productionId}/tasks/${this.taskId}/file?person_id=${this.personId}&mac=${navigator.userAgent.includes('Macintosh')}`
          const p = await fetch(url, {
            headers: {
              'X-Tenant-Id': tenant,
            }
          })
          if (!p.ok) return
          this.link = await p.text()
        } catch(error) {
          console.log(error)
        }
      },
      immediate: true
    }
  }
}
</script>
<style scoped>
.menu-item {
  padding-top:0;
  margin-top:-.5em;
}
.menu-item a {
  text-transform: uppercase;
}
</style>