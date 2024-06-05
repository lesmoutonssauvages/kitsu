<template>
  <div class="menu-item" style="text-align: center; line-height: 1em;" v-if="taskId && link && selectedTaskIds.length === 1">
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
    }
  },
  watch: {
    taskId: {
      async handler(newVal) {
        this.link = ''
        try {
          if (!this.taskId) return
          const tld = document.location.host.split('.')
          if (!tld) return
          const ext = tld.pop() === 'tv' ? 'tv' : 'local'
          const [,corset] = tld
          let tenant = 'studio'
          if (corset === 'lecorset' || corset === '0') {
            tenant = 'lecorset'
          }
          let url = `https://api.tools.eddystudio.${ext}/projects/${this.productionId}/tasks/${this.taskId}/file?person_id=${this.personId}&mac=${navigator.userAgent.includes('Macintosh')}`
          const p = await fetch(url, {
            headers: {
              'X-Tenant-Id': `${tenant}-zou-app`,
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
</style>