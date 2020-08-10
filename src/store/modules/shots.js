import Vue from 'vue'
import moment from 'moment'
import breakdownApi from '../api/breakdown'
import peopleApi from '../api/people'
import shotsApi from '../api/shots'
import tasksStore from './tasks'
import peopleStore from './people'
import taskTypesStore from './tasktypes'

import { PAGE_SIZE } from '../../lib/pagination'
import {
  sortByName,
  sortSequences,
  sortShotResult,
  sortShots,
  sortTasks,
  sortValidationColumns
} from '../../lib/sorting'
import {
  appendSelectionGrid,
  buildSelectionGrid,
  clearSelectionGrid
} from '../../lib/selection'
import {
  getFilledColumns,
  groupEntitiesByParents,
  removeModelFromList
} from '../../lib/models'
import {
  computeStats
} from '../../lib/stats'
import {
  frameToSeconds
} from '../../lib/video'
import {
  minutesToDays
} from '../../lib/time'
import {
  buildShotIndex,
  buildSequenceIndex,
  buildEpisodeIndex,
  indexSearch
} from '../../lib/indexing'
import {
  applyFilters,
  getFilters,
  getKeyWords
} from '../../lib/filtering'

import {
  CLEAR_SHOTS,

  LOAD_ASSET_CASTING_END,

  LOAD_SHOTS_START,
  LOAD_SHOTS_ERROR,
  LOAD_SHOTS_END,
  LOAD_EPISODES_END,
  LOAD_SEQUENCES_END,

  LOAD_SHOT_END,
  LOAD_SHOT_CASTING_END,

  SHOT_CSV_FILE_SELECTED,
  IMPORT_SHOTS_END,

  LOAD_OPEN_PRODUCTIONS_END,

  NEW_SHOT_END,
  NEW_SEQUENCE_END,
  NEW_EPISODE_END,
  EDIT_SHOT_END,
  EDIT_SEQUENCE_END,
  EDIT_EPISODE_END,
  ADD_EPISODE,
  UPDATE_EPISODE,
  REMOVE_EPISODE,
  ADD_SEQUENCE,
  UPDATE_SEQUENCE,
  REMOVE_SEQUENCE,
  ADD_SHOT,
  UPDATE_SHOT,
  REMOVE_SHOT,
  CANCEL_SHOT,
  RESTORE_SHOT_END,

  NEW_TASK_COMMENT_END,
  NEW_TASK_END,
  CREATE_TASKS_END,

  SET_SHOT_SEARCH,
  SET_SEQUENCE_SEARCH,
  SET_EPISODE_SEARCH,

  RESET_PRODUCTION_PATH,
  SET_CURRENT_PRODUCTION,
  SET_CURRENT_EPISODE,
  DISPLAY_MORE_SHOTS,
  DISPLAY_MORE_SEQUENCES,
  DISPLAY_MORE_EPISODES,
  CLEAR_EPISODES,

  SET_SHOT_LIST_SCROLL_POSITION,
  SET_SEQUENCE_LIST_SCROLL_POSITION,
  SET_EPISODE_LIST_SCROLL_POSITION,

  REMOVE_SELECTED_TASK,
  ADD_SELECTED_TASK,
  ADD_SELECTED_TASKS,
  DELETE_TASK_END,
  CLEAR_SELECTED_TASKS,

  SET_PREVIEW,

  SAVE_SHOT_SEARCH_END,
  REMOVE_SHOT_SEARCH_END,
  SAVE_SEQUENCE_SEARCH_END,
  REMOVE_SEQUENCE_SEARCH_END,

  COMPUTE_SEQUENCE_STATS,
  COMPUTE_EPISODE_STATS,
  SET_EPISODE_STATS,

  CHANGE_SHOT_SORT,

  RESET_ALL
} from '../mutation-types'

const AVERAGE = 'average'
const COUNT = 'count'
const TOTAL = 'total'

const cache = {
  shots: [],
  shotIndex: []
}

const helpers = {
  getTask (taskId) {
    return tasksStore.state.taskMap[taskId]
  },
  getTaskStatus (taskStatusId) {
    return tasksStore.state.taskStatusMap[taskStatusId]
  },
  getTaskType (taskTypeId) {
    return taskTypesStore.state.taskTypeMap[taskTypeId]
  },
  getPerson (personId) {
    return peopleStore.state.personMap[personId]
  },

  getShotName (shot) {
    let shotName = `${shot.sequence_name} / ${shot.name}`
    if (shot.episode_name) {
      shotName = `${shot.episode_name} / ${shotName}`
    }
    return shotName
  },

  dateDigit (date) {
    return date.toString().padStart(2, '0')
  },

  populateTask (task, shot) {
    task.name = helpers.getTaskType(task.task_type_id).priority.toString()
    task.task_status_short_name =
      helpers.getTaskStatus(task.task_status_id).short_name

    const shotName = helpers.getShotName(shot)
    Object.assign(task, {
      project_id: shot.production_id,
      entity_name: shotName,
      entity_type_name: 'Shot',
      sequence_name: shot.sequence_name,
      entity: {
        id: shot.id,
        preview_file_id: shot.preview_file_id
      }
    })

    return task
  },

  setListStats (state, shots) {
    let timeSpent = 0
    let nbFrames = 0
    shots.forEach((shot) => {
      timeSpent += shot.timeSpent
      nbFrames += shot.nb_frames
    })
    Object.assign(state, {
      displayedShotsLength: shots.length,
      displayedShotsTimeSpent: timeSpent,
      displayedShotsFrames: nbFrames
    })
  },

  sortValidationColumns (validationColumns, shotFilledColumns, taskTypeMap) {
    const columns = [...validationColumns]
    return sortValidationColumns(columns, taskTypeMap)
  },

  getPeriod (task, detailLevel) {
    const endDateString = helpers.getTaskEndDate(task, detailLevel)
    let period
    if (detailLevel === 'day') {
      period = moment(endDateString, 'YYYY-MM').format('YYYY-MM')
    } else if (detailLevel === 'month') {
      period = moment(endDateString, 'YYYY').format('YYYY')
    } else if (detailLevel === 'week') {
      period = moment(endDateString, 'YYYY-MM-DD').format('GGGG')
    }
    return period
  },

  getDateFromParameters ({ detailLevel, year, week, month, day }) {
    if (detailLevel === 'day') {
      return `${year}-${helpers.dateDigit(month)}-${helpers.dateDigit(day)}`
    } else if (detailLevel === 'month') {
      return `${year}-${helpers.dateDigit(month)}`
    } else if (detailLevel === 'week') {
      return `${year}-${week}`
    } else {
      return `${year}`
    }
  },

  getTaskEndDate (task, detailLevel) {
    let endDateString
    if (detailLevel === 'day') {
      endDateString = moment(task.end_date, 'YYYY-MM-DD').format('YYYY-MM-DD')
    } else if (detailLevel === 'month') {
      endDateString = moment(task.end_date, 'YYYY-MM').format('YYYY-MM')
    } else if (detailLevel === 'week') {
      endDateString = moment(task.end_date, 'YYYY-MM-DD').format('GGGG-W')
    }
    return endDateString
  },

  initQuota (quotas, personId, endDateString, period) {
    if (!quotas[personId]) quotas[personId] = {}
    const personQuotas = quotas[personId]

    if (!personQuotas[endDateString]) personQuotas[endDateString] = 0
    if (!personQuotas[AVERAGE]) personQuotas[AVERAGE] = {}
    if (!personQuotas[AVERAGE][period]) personQuotas[AVERAGE][period] = 0
    if (!personQuotas[COUNT]) personQuotas[COUNT] = {}
    if (!personQuotas[COUNT][period]) {
      personQuotas[COUNT][period] = 0
    }
    if (!personQuotas[TOTAL]) personQuotas[TOTAL] = {}
    if (!personQuotas[TOTAL][period]) personQuotas[TOTAL][period] = 0

    return personQuotas
  },

  buildResult (state, {
    shotSearch,
    production,
    sorting,
    taskStatusMap,
    taskTypeMap,
    persons,
    taskMap
  }) {
    const taskTypes = Object.values(taskTypeMap)
    const taskStatuses = Object.values(taskStatusMap)

    const query = shotSearch
    const keywords = getKeyWords(query) || []
    const filters = getFilters({
      entryIndex: cache.shotIndex,
      assetTypes: [],
      taskTypes,
      taskStatuses,
      descriptors: production.descriptors,
      persons,
      query
    })
    let result = indexSearch(cache.shotIndex, keywords) || cache.shots
    result = applyFilters(result, filters, taskMap)
    result = sortShotResult(
      result,
      sorting,
      taskStatusMap,
      taskTypeMap,
      taskMap
    )
    cache.result = result

    const displayedShots = result.slice(0, PAGE_SIZE)
    const maxX = displayedShots.length
    const maxY = state.nbValidationColumns

    helpers.setListStats(state, result)
    Object.assign(state, {
      displayedShots: displayedShots,
      shotFilledColumns: getFilledColumns(displayedShots),
      shotSearchText: shotSearch,
      shotSelectionGrid: buildSelectionGrid(maxX, maxY)
    })
  }
}

const initialState = {
  shotMap: {},
  sequences: [],
  episodes: [],
  shotSearchText: '',
  shotSearchQueries: [],
  sequenceSearchQueries: [],
  sequenceSearchText: '',
  sequenceStats: {},
  episodeSearchText: '',
  episodeStats: {},
  shotSorting: [],

  currentEpisode: null,
  episodeValidationColumns: [],

  isFps: false,
  isFrames: false,
  isFrameIn: false,
  isFrameOut: false,
  isTime: false,
  isShotDescription: false,

  displayedShots: [],
  displayedShotsLength: 0,
  displayedShotsTimeSpent: 0,
  displayedShotsFrames: 0,
  displayedSequences: [],
  displayedSequencesLength: 0,
  displayedEpisodes: [],
  displayedEpisodesLength: 0,
  sequenceIndex: {},
  shotFilledColumns: {},

  sequenceMap: {},
  episodeMap: {},
  shotCreated: '',
  shotSelectionGrid: {},
  sequenceSelectionGrid: {},

  isShotsLoading: false,
  isShotsLoadingError: false,
  shotsCsvFormData: null,

  shotListScrollPosition: 0,
  sequenceListScrollPosition: 0,
  episodeListScrollPosition: 0,

  searchSequenceFilters: [],
  shotValidationColumns: []
}

const state = {
  ...initialState
}

const getters = {
  sequences: state => state.sequences,
  sequenceMap: state => state.sequenceMap,
  sequenceStats: state => state.sequenceStats,
  episodes: state => state.episodes,
  episodeMap: state => state.episodeMap,
  episodeStats: state => state.episodeStats,
  shotValidationColumns: state => state.shotValidationColumns,

  currentEpisode: state => state.currentEpisode,

  shotSearchQueries: state => state.shotSearchQueries,
  sequenceSearchQueries: state => state.sequenceSearchQueries,
  shotMap: state => state.shotMap,
  shotSorting: state => state.shotSorting,

  isFps: state => state.isFps,
  isFrames: state => state.isFrames,
  isFrameIn: state => state.isFrameIn,
  isFrameOut: state => state.isFrameOut,
  isTime: state => state.isTime,
  isShotDescription: state => state.isShotDescription,

  shotSearchText: state => state.shotSearchText,
  sequenceSearchText: state => state.sequenceSearchText,
  episodeSearchText: state => state.episodeSearchText,
  shotSelectionGrid: state => state.shotSelectionGrid,
  sequenceSelectionGrid: state => state.sequenceSelectionGrid,

  displayedShots: state => state.displayedShots,
  displayedShotsLength: state => state.displayedShotsLength,
  displayedShotsTimeSpent: state => state.displayedShotsTimeSpent,
  displayedShotsFrames: state => state.displayedShotsFrames,
  displayedSequences: state => state.displayedSequences,
  displayedSequencesLength: state => state.displayedSequencesLength,
  displayedEpisodes: state => state.displayedEpisodes,
  displayedEpisodesLength: state => state.displayedEpisodesLength,
  shotFilledColumns: state => state.shotFilledColumns,

  displayedShotsBySequence: state => {
    return groupEntitiesByParents(state.displayedShots, 'sequence_name')
  },

  isShotsLoading: state => state.isShotsLoading,
  isShotsLoadingError: state => state.isShotsLoadingError,
  shotCreated: state => state.shotCreated,

  shotsCsvFormData: state => state.shotsCsvFormData,
  shotListScrollPosition: state => state.shotListScrollPosition,
  sequenceListScrollPosition: state => state.sequenceListScrollPosition,
  episodeListScrollPosition: state => state.episodeListScrollPosition,

  episodeValidationColumns: state => state.episodeValidationColumns,

  shotsByEpisode: state => {
    const shotsBySequence = []
    let sequenceShots = []
    let previousShot = null

    for (const shot of Object.values(state.shotMap)) {
      if (previousShot && shot.sequence_name !== previousShot.sequence_name) {
        shotsBySequence.push(sequenceShots.slice(0))
        sequenceShots = []
      }
      sequenceShots.push(shot)
      previousShot = shot
    }
    shotsBySequence.push(sequenceShots)

    return shotsBySequence
  },

  searchSequenceFilters: state => state.searchSequenceFilters,

  getSequenceOptions: state => state.sequences.map(
    (sequence) => { return { label: sequence.name, value: sequence.id } }
  ),

  getEpisodeOptions: state => state.episodes.map(
    (episode) => { return { label: episode.name, value: episode.id } }
  ),

  isSingleEpisode: state => state.episodes.length < 2,

  episodeOptions: state => state.episodes.map(
    (episode) => { return { label: episode.name, value: episode.id } }
  )
}

const actions = {

  getPending ({ commit }, daily = false) {
    return new Promise((resolve, reject) => {
      const shots = []
      cache.shots.forEach((shot) => {
        let isPending = false
        shot.tasks.forEach((taskId) => {
          const task = tasksStore.state.taskMap[taskId]
          if (!isPending) {
            if (daily) {
              if (task.last_comment_date) {
                const lastCommentDate = moment(task.last_comment_date)
                const yesterday = moment().subtract(1, 'days')
                isPending =
                  task.task_status_short_name === 'wfa' &&
                  lastCommentDate.isAfter(yesterday)
              }
            } else {
              isPending = task.task_status_short_name === 'wfa'
            }
          }
        })
        if (isPending) shots.push(shot)
      })
      resolve(shots)
    })
  },

  clearEpisodes ({ commit }) {
    commit(CLEAR_EPISODES)
  },

  loadEpisodes ({ commit, state, rootGetters }, callback) {
    const currentProduction = rootGetters.currentProduction
    const routeEpisodeId = rootGetters.route.params.episode_id
    shotsApi.getEpisodes(currentProduction, (err, episodes) => {
      if (err) console.error(err)
      commit(LOAD_EPISODES_END, { episodes, routeEpisodeId })
      if (callback) callback()
    })
  },

  loadShots ({ commit, dispatch, state, rootGetters }, callback) {
    const production = rootGetters.currentProduction
    const userFilters = rootGetters.userFilters
    const taskTypeMap = rootGetters.taskTypeMap
    const taskMap = rootGetters.taskMap
    const personMap = rootGetters.personMap
    const isTVShow = rootGetters.isTVShow
    let episode = isTVShow ? rootGetters.currentEpisode : null

    if (episode && ['all', 'main'].includes(episode.id)) {
      episode = state.episodes.length > 0 ? state.episodes[0] : null
      if (episode.project_id !== production.id) return
      commit(SET_CURRENT_EPISODE, episode.id)
    }

    if (isTVShow && !episode) {
      return callback()
    }

    if (!isTVShow && episode) {
      commit(SET_CURRENT_EPISODE, null)
    }

    if (state.isShotsLoading) {
      return callback()
    }

    commit(LOAD_SHOTS_START)
    shotsApi.getSequences(production, episode, (err, sequences) => {
      if (err) commit(LOAD_SHOTS_ERROR)
      else {
        shotsApi.getShots(production, episode, (err, shots) => {
          if (err) commit(LOAD_SHOTS_ERROR)
          else {
            commit(LOAD_SEQUENCES_END, sequences)
            commit(
              LOAD_SHOTS_END,
              {
                production,
                shots,
                userFilters,
                taskTypeMap,
                taskMap,
                personMap
              }
            )
          }
          if (callback) callback(err)
        })
      }
    })
  },

  loadEpisode ({ commit, state }, episodeId) {
    return shotsApi.getEpisode(episodeId)
      .then((episode) => {
        if (state.episodeMap[episode.id]) {
          commit(UPDATE_EPISODE, episode)
        } else {
          commit(ADD_EPISODE, episode)
        }
      })
      .catch(console.error)
  },

  loadSequence ({ commit, state }, sequenceId) {
    return shotsApi.getSequence(sequenceId)
      .then((sequence) => {
        if (state.sequenceMap[sequence.id]) {
          commit(UPDATE_SEQUENCE, sequence)
        } else {
          commit(ADD_SEQUENCE, sequence)
        }
      })
      .catch(console.error)
  },

  loadShot ({ commit, state, rootGetters }, shotId) {
    const personMap = rootGetters.personMap
    const production = rootGetters.currentProduction
    const taskMap = rootGetters.taskMap
    const taskTypeMap = rootGetters.taskTypeMap
    return shotsApi.getShot(shotId)
      .then((shot) => {
        if (state.shotMap[shot.id]) {
          commit(UPDATE_SHOT, shot)
        } else {
          commit(ADD_SHOT, {
            shot,
            taskTypeMap,
            taskMap,
            personMap,
            production
          })
        }
      })
      .catch((err) => console.error(err))
  },

  loadAssetCasting ({ commit, rootGetters }, asset) {
    const assetMap = rootGetters.assetMap
    return breakdownApi.getAssetCasting(asset)
      .then((casting) => {
        commit(LOAD_ASSET_CASTING_END, { asset, casting, assetMap })
      })
  },

  loadShotCasting ({ commit, rootGetters }, shot) {
    const assetMap = rootGetters.assetMap
    return breakdownApi.getShotCasting(shot)
      .then((casting) => {
        commit(LOAD_SHOT_CASTING_END, { shot, casting, assetMap })
      })
  },

  newShot ({ commit, dispatch, rootGetters }, shot) {
    return shotsApi.newShot(shot)
      .then((shot) => {
        commit(NEW_SHOT_END, shot)
        const taskTypeIds = state.shotValidationColumns
        const createTaskPromises = taskTypeIds.map(
          (taskTypeId) => dispatch('createTask', {
            entityId: shot.id,
            projectId: shot.project_id,
            taskTypeId: taskTypeId,
            type: 'shots'
          })
        )
        return Promise.all(createTaskPromises)
          .then(() => {
            return Promise.resolve(shot)
          })
          .catch(console.error)
      })
  },

  newSequence ({ commit, state }, sequence) {
    return shotsApi.newSequence(sequence)
      .then((sequence) => {
        commit(NEW_SEQUENCE_END, sequence)
        return Promise.resolve(sequence)
      })
  },

  newEpisode ({ commit, state }, episode) {
    return shotsApi.newEpisode(episode)
      .then((episode) => {
        commit(NEW_EPISODE_END, episode)
        return Promise.resolve(episode)
      })
  },

  editShot ({ commit, state }, data) {
    return shotsApi.updateShot(data)
      .then((shot) => {
        commit(EDIT_SHOT_END, shot)
        return Promise.resolve(shot)
      })
  },

  editEpisode ({ commit, state }, data) {
    return shotsApi.updateEpisode(data)
      .then((episode) => {
        commit(EDIT_EPISODE_END, episode)
        return Promise.resolve(episode)
      })
  },

  editSequence ({ commit, state }, data) {
    return shotsApi.updateSequence(data)
      .then((sequence) => {
        commit(EDIT_SEQUENCE_END, sequence)
        return Promise.resolve(sequence)
      })
  },

  deleteShot ({ commit, state }, shot) {
    return shotsApi.deleteShot(shot)
      .then(() => {
        const previousShot = state.shotMap[shot.id]
        if (
          previousShot &&
          previousShot.tasks.length > 0 &&
          !previousShot.canceled
        ) {
          commit(CANCEL_SHOT, previousShot)
        } else {
          commit(REMOVE_SHOT, shot)
        }
        return Promise.resolve()
      })
  },

  deleteEpisode ({ commit, state }, episode) {
    return shotsApi.deleteEpisode(episode)
      .then(() => {
        commit(REMOVE_EPISODE, episode)
        return Promise.resolve(episode)
      })
  },

  deleteSequence ({ commit, state }, sequence) {
    return shotsApi.deleteSequence(sequence)
      .then(() => {
        commit(REMOVE_SEQUENCE, sequence)
        return Promise.resolve(sequence)
      })
  },

  restoreShot ({ commit, state }, shot) {
    return shotsApi.restoreShot(shot)
      .then((shot) => {
        commit(RESTORE_SHOT_END, shot)
        return Promise.resolve(shot)
      })
  },

  uploadShotFile ({ commit, state, rootGetters }, toUpdate) {
    const production = rootGetters.currentProduction
    return shotsApi.postCsv(production, state.shotsCsvFormData, toUpdate)
      .then(() => {
        commit(IMPORT_SHOTS_END)
        return Promise.resolve()
      })
  },

  displayMoreShots ({ commit, rootGetters }) {
    commit(DISPLAY_MORE_SHOTS, {
      taskTypeMap: rootGetters.taskTypeMap,
      taskStatusMap: rootGetters.taskStatusMap,
      taskMap: rootGetters.taskMap,
      production: rootGetters.currentProduction
    })
  },

  displayMoreSequences ({ commit }) {
    commit(DISPLAY_MORE_SEQUENCES)
  },

  displayMoreEpisodes ({ commit }) {
    commit(DISPLAY_MORE_EPISODES)
  },

  setShotSearch ({ commit, rootGetters }, shotSearch) {
    const taskStatusMap = rootGetters.taskStatusMap
    const taskTypeMap = rootGetters.taskTypeMap
    const taskMap = rootGetters.taskMap
    const production = rootGetters.currentProduction
    const persons = rootGetters.people
    commit(
      SET_SHOT_SEARCH,
      { shotSearch, persons, taskStatusMap, taskMap, taskTypeMap, production }
    )
  },

  saveShotSearch ({ commit, rootGetters }, searchQuery) {
    return new Promise((resolve, reject) => {
      const query = state.shotSearchQueries.find(
        (query) => query.name === searchQuery
      )
      const production = rootGetters.currentProduction

      if (!query) {
        peopleApi.createFilter(
          'shot',
          searchQuery,
          searchQuery,
          production.id,
          null,
          (err, searchQuery) => {
            commit(SAVE_SHOT_SEARCH_END, { searchQuery, production })
            if (err) {
              reject(err)
            } else {
              resolve(searchQuery)
            }
          }
        )
      } else {
        resolve()
      }
    })
  },

  removeShotSearch ({ commit, rootGetters }, searchQuery) {
    return new Promise((resolve, reject) => {
      const production = rootGetters.currentProduction
      peopleApi.removeFilter(searchQuery, (err) => {
        commit(REMOVE_SHOT_SEARCH_END, { searchQuery, production })
        if (err) reject(err)
        else resolve()
      })
    })
  },

  saveSequenceSearch ({ commit, rootGetters }, searchQuery) {
    return new Promise((resolve, reject) => {
      const query = state.sequenceSearchQueries.find(
        (query) => query.name === searchQuery
      )
      const production = rootGetters.currentProduction

      if (!query) {
        peopleApi.createFilter(
          'sequence',
          searchQuery,
          searchQuery,
          production.id,
          null,
          (err, searchQuery) => {
            commit(SAVE_SEQUENCE_SEARCH_END, { searchQuery, production })
            if (err) {
              reject(err)
            } else {
              resolve(searchQuery)
            }
          }
        )
      } else {
        resolve()
      }
    })
  },

  removeSequenceSearch ({ commit, rootGetters }, searchQuery) {
    return new Promise((resolve, reject) => {
      const production = rootGetters.currentProduction
      peopleApi.removeFilter(searchQuery, (err) => {
        commit(REMOVE_SEQUENCE_SEARCH_END, { searchQuery, production })
        if (err) reject(err)
        else resolve()
      })
    })
  },

  initSequences ({ commit, dispatch, state, rootState, rootGetters }) {
    return new Promise((resolve, reject) => {
      const productionId = rootState.route.params.production_id
      dispatch('setLastProductionScreen', 'sequences')
      if (state.sequences.length === 0 ||
          state.sequences[0].production_id !== productionId) {
        dispatch('computeSequenceStats')
        resolve()
      } else {
        resolve()
      }
    })
  },

  setSequenceSearch ({ commit, rootGetters }, sequenceSearch) {
    commit(SET_SEQUENCE_SEARCH, {
      sequenceSearch,
      production: rootGetters.currentProduction
    })
  },

  setSequenceListScrollPosition ({ commit }, scrollPosition) {
    commit(SET_SEQUENCE_LIST_SCROLL_POSITION, scrollPosition)
  },

  computeSequenceStats ({ commit, rootGetters }) {
    const taskStatusMap = rootGetters.taskStatusMap
    const taskMap = rootGetters.taskMap
    commit(COMPUTE_SEQUENCE_STATS, { taskStatusMap, taskMap })
  },

  setCurrentEpisode ({ commit, rootGetters }, episodeId) {
    commit(SET_CURRENT_EPISODE, episodeId)

    const productionId = rootGetters.currentProduction.id
    commit(RESET_PRODUCTION_PATH, { productionId, episodeId })
  },

  initEpisodes ({ commit, dispatch, state, rootState, rootGetters }) {
    return new Promise((resolve, reject) => {
      const productionId = rootState.route.params.production_id
      const isTVShow = rootGetters.isTVShow
      dispatch('setLastProductionScreen', 'episodes')

      if (state.episodes.length === 0 ||
          state.episodes[0].production_id !== productionId) {
        if (isTVShow) {
          dispatch('loadEpisodes', () => {
            return dispatch('loadEpisodeStats', productionId)
          })
        } else {
          dispatch('computeEpisodeStats')
          resolve()
        }
      }
    })
  },

  loadEpisodeStats ({ commit, rootGetters }, productionId) {
    const taskTypeMap = rootGetters.taskTypeMap
    commit(SET_EPISODE_STATS, { episodeStats: {}, taskTypeMap })
    return shotsApi.getEpisodeStats(productionId)
      .then((episodeStats) => {
        commit(SET_EPISODE_STATS, { episodeStats, taskTypeMap })
        return Promise.resolve()
      })
      .catch(console.error)
  },

  setEpisodeSearch ({ commit }, searchQuery) {
    commit(SET_EPISODE_SEARCH, searchQuery)
  },

  setEpisodeListScrollPosition ({ commit }, scrollPosition) {
    commit(SET_EPISODE_LIST_SCROLL_POSITION, scrollPosition)
  },

  computeEpisodeStats ({ commit, dispatch, rootGetters }) {
    const taskStatusMap = rootGetters.taskStatusMap
    const taskMap = rootGetters.taskMap
    const isTVShow = rootGetters.isTVShow
    if (!isTVShow) {
      commit(COMPUTE_EPISODE_STATS, { taskStatusMap, taskMap })
    } else {
      dispatch('loadEpisodeStats', rootGetters.currentProduction.id)
    }
  },

  getShotsCsvLines ({ state, rootGetters }) {
    const production = rootGetters.currentProduction
    const organisation = rootGetters.organisation
    let shots = cache.shots
    if (cache.result && cache.result.length > 0) {
      shots = cache.result
    }
    const lines = shots.map((shot) => {
      const shotLine = [
        shot.sequence_name,
        shot.name,
        shot.description
      ]
      sortByName([...production.descriptors])
        .filter(d => d.entity_type === 'Shot')
        .forEach((descriptor) => {
          shotLine.push(shot.data[descriptor.field_name])
        })
      if (state.isTime) {
        shotLine.push(minutesToDays(organisation, shot.timeSpent).toFixed(2))
      }
      if (state.isFrames) shotLine.push(shot.nb_frames)
      if (state.isFrameIn) shotLine.push(shot.data.frame_in)
      if (state.isFrameOut) shotLine.push(shot.data.frame_out)
      if (state.isFps) shotLine.push(shot.data.fps)
      state.shotValidationColumns
        .forEach((validationColumn) => {
          const task = rootGetters.taskMap[shot.validations[validationColumn]]
          if (task) {
            shotLine.push(task.task_status_short_name)
          } else {
            shotLine.push('')
          }
        })
      return shotLine
    })
    return lines
  },

  loadShotHistory ({ commit, state }, shotId) {
    return shotsApi.loadShotHistory(shotId)
  },

  computeQuota (
    { commit, state, rootGetters },
    { taskTypeId, detailLevel, countMode }) {
    const taskMap = rootGetters.taskMap
    const taskStatusMap = rootGetters.taskStatusMap
    const production = rootGetters.currentProduction
    const quotas = {}

    cache.shots.forEach((shot) => {
      const task = taskMap[shot.validations[taskTypeId]]
      const isTaskFinished = task && taskStatusMap[task.task_status_id].is_done
      if (isTaskFinished) {
        const period = helpers.getPeriod(task, detailLevel)
        const endDateString = helpers.getTaskEndDate(task, detailLevel)

        task.assignees.forEach(personId => {
          const personQuotas =
            helpers.initQuota(quotas, personId, endDateString, period)
          if (shot.nb_frames) {
            let quota = shot.nb_frames
            if (countMode === 'seconds') {
              quota = frameToSeconds(shot.nb_frames, production, shot)
            }
            const isNewQuotaDay = personQuotas[endDateString] === 0
            if (isNewQuotaDay) personQuotas[COUNT][period]++
            personQuotas[endDateString] += quota
            personQuotas[TOTAL][period] += quota
            if (countMode === 'seconds') {
              personQuotas[TOTAL][period] =
                Math.round(personQuotas[TOTAL][period] * 100) / 100
              personQuotas[endDateString] =
                Math.round(personQuotas[endDateString] * 100) / 100
            }
            personQuotas[AVERAGE][period] =
              personQuotas[TOTAL][period] / personQuotas[COUNT][period]
          }
        })
      }
    })
    return Promise.resolve(quotas)
  },

  getPersonShots (
    { commit, state, rootGetters },
    { taskTypeId, detailLevel, personId, year, month, week, day }
  ) {
    const taskStatusMap = rootGetters.taskStatusMap
    const dateString = helpers.getDateFromParameters({
      detailLevel, year, month, week, day
    })

    const shots = cache.shots.filter((shot) => {
      const task = rootGetters.taskMap[shot.validations[taskTypeId]]
      if (task) {
        const taskStatus = taskStatusMap[task.task_status_id]
        const endDateString = helpers.getTaskEndDate(task, detailLevel)
        return (
          task &&
          taskStatus.is_done &&
          task.assignees.includes(personId) &&
          endDateString === dateString
        )
      } else {
        return false
      }
    })
      .map(shot => ({
        ...shot,
        full_name: helpers.getShotName(shot)
      }))
    return Promise.resolve(shots)
  },

  changeShotSort ({ commit, rootGetters }, sortInfo) {
    const taskStatusMap = rootGetters.taskStatus
    const taskTypeMap = rootGetters.taskTypeMap
    const taskMap = rootGetters.taskMap
    const persons = rootGetters.people
    const production = rootGetters.currentProduction
    const sorting = sortInfo ? [sortInfo] : []
    commit(CHANGE_SHOT_SORT, {
      taskStatusMap, taskTypeMap, taskMap, persons, production, sorting
    })
  }
}

const mutations = {
  [CLEAR_SHOTS] (state) {
    cache.shots = []
    cache.result = []
    cache.shotIndex = {}
    state.shotMap = {}

    state.sequences = []
    state.sequenceIndex = {}
    state.displayedShots = []
    state.displayedShotsLength = 0
    state.displayedTimeSpent = 0
    state.displayedFrames = 0
    state.shotSearchQueries = []
    state.displayedSequences = []
    state.displayedSequencesLength = 0
    state.displayedEpisodes = []
    state.displayedEpisodesLength = 0
  },

  [LOAD_SHOTS_START] (state) {
    cache.shots = []
    cache.result = []
    cache.shotIndex = {}
    state.shotMap = {}
    state.shotValidationColumns = []

    state.sequences = []
    state.isShotsLoading = true
    state.isShotsLoadingError = false

    state.sequenceIndex = {}
    state.displayedShots = []
    state.displayedShotsLength = 0
    state.displayedTimeSpent = 0
    state.displayedFrames = 0
    state.shotSearchQueries = []
    state.displayedSequences = []
    state.displayedSequencesLength = 0
    state.displayedEpisodes = []
    state.displayedEpisodesLength = 0
  },

  [LOAD_SHOTS_ERROR] (state) {
    state.isShotsLoading = false
    state.isShotsLoadingError = true
  },

  [LOAD_SHOTS_END] (
    state,
    { production, shots, userFilters, taskMap, taskTypeMap, personMap }
  ) {
    const validationColumns = {}
    let isFps = false
    let isFrames = false
    let isFrameIn = false
    let isFrameOut = false
    let isDescription = false
    let isTime = false
    shots = sortShots(shots)
    cache.shots = shots
    cache.result = shots
    cache.shotIndex = buildShotIndex(shots)

    state.shotMap = {}
    shots.forEach((shot) => {
      const taskIds = []
      const validations = {}
      let timeSpent = 0
      shot.project_name = production.name
      shot.production_id = production.id
      shot.tasks.forEach((task) => {
        helpers.populateTask(task, shot, production)
        timeSpent += task.duration
        task.episode_id = shot.episode_id

        taskMap[task.id] = task
        validations[task.task_type_id] = task.id
        taskIds.push(task.id)

        const taskType = taskTypeMap[task.task_type_id]
        if (!validationColumns[taskType.name]) {
          validationColumns[taskType.name] = taskType.id
        }
        if (task.assignees.length > 1) {
          task.assignees = task.assignees.sort((a, b) => {
            return personMap[a].name.localeCompare(personMap[b])
          })
        }
      })
      shot.tasks = taskIds
      shot.validations = validations
      shot.timeSpent = timeSpent

      if (!isFps && shot.data.fps) isFps = true
      if (!isFrames && shot.nb_frames) isFrames = true
      if (!isFrameIn && shot.data.frame_in) isFrameIn = true
      if (!isFrameOut && shot.data.frame_out) isFrameOut = true
      if (!isTime && shot.timeSpent > 0) isTime = true
      if (!isDescription && shot.description) isDescription = true

      state.shotMap[shot.id] = shot
    })
    const displayedShots = shots.slice(0, PAGE_SIZE)
    const filledColumns = getFilledColumns(displayedShots)

    state.shotValidationColumns = helpers.sortValidationColumns(
      Object.values(validationColumns), filledColumns, taskTypeMap
    )

    state.nbValidationColumns = state.shotValidationColumns.length
    state.isFps = isFps
    state.isFrames = isFrames
    state.isFrameIn = isFrameIn
    state.isFrameOut = isFrameOut
    state.isTime = isTime
    state.isShotDescription = isDescription

    state.isShotsLoading = false
    state.isShotsLoadingError = false

    state.displayedShots = displayedShots
    state.shotFilledColumns = filledColumns

    const maxX = state.displayedShots.length
    const maxY = state.nbValidationColumns
    state.shotSelectionGrid = buildSelectionGrid(maxX, maxY)
    helpers.setListStats(state, shots)

    if (userFilters.shot && userFilters.shot[production.id]) {
      state.shotSearchQueries = userFilters.shot[production.id]
    } else {
      state.shotSearchQueries = []
    }

    if (userFilters.sequence && userFilters.sequence[production.id]) {
      state.sequenceSearchQueries = userFilters.sequence[production.id]
    } else {
      state.sequenceSearchQueries = []
    }
  },

  [SAVE_SHOT_SEARCH_END] (state, { searchQuery }) {
    state.shotSearchQueries.push(searchQuery)
    state.shotSearchQueries = sortByName(state.shotSearchQueries)
  },

  [REMOVE_SHOT_SEARCH_END] (state, { searchQuery }) {
    const queryIndex = state.shotSearchQueries.findIndex(
      (query) => query.name === searchQuery.name
    )
    if (queryIndex >= 0) {
      state.shotSearchQueries.splice(queryIndex, 1)
    }
  },

  [SAVE_SEQUENCE_SEARCH_END] (state, { searchQuery }) {
    state.sequenceSearchQueries.push(searchQuery)
    state.sequenceSearchQueries = sortByName(state.sequenceSearchQueries)
  },

  [REMOVE_SEQUENCE_SEARCH_END] (state, { searchQuery }) {
    state.sequenceSearchQueries = state
      .sequenceSearchQueries
      .filter((query) => query.name !== searchQuery.name)
  },

  [LOAD_SEQUENCES_END] (state, sequences) {
    const sequenceMap = {}
    sequences.forEach((sequence) => {
      sequenceMap[sequence.id] = sequence
      if (sequence.parent_id) {
        const episode = state.episodeMap[sequence.parent_id]
        if (episode) {
          Object.assign(sequence, {
            episode_id: episode.id,
            episode_name: episode.name
          })
        }
      }
    })
    const sortedSequences = sortSequences(sequences)
    state.sequenceMap = sequenceMap
    state.sequences = sortedSequences
    state.sequenceIndex = buildSequenceIndex(sortedSequences)
    state.displayedSequences = sortedSequences.slice(0, PAGE_SIZE * 2)
    state.displayedSequencesLength = sortedSequences.length
  },

  [LOAD_EPISODES_END] (state, { episodes, routeEpisodeId }) {
    const episodeMap = {}
    if (!episodes) episodes = []
    episodes.forEach((episode) => {
      episodeMap[episode.id] = episode
    })
    state.episodeMap = episodeMap
    state.episodes = sortByName(episodes)

    state.episodeIndex = buildEpisodeIndex(state.episodes)
    state.displayedEpisodes = state.episodes.slice(0, PAGE_SIZE)
    state.displayedEpisodesLength = state.episodes.length

    if (state.episodes.length > 0) {
      if (routeEpisodeId === 'all') {
        state.currentEpisode = { id: 'all' }
      } else if (routeEpisodeId === 'main') {
        state.currentEpisode = { id: 'main' }
      } else if (routeEpisodeId) {
        state.currentEpisode = state.episodeMap[routeEpisodeId]
      } else {
        state.currentEpisode = state.episodes[0]
      }
    } else {
      state.currentEpisode = null
    }
  },

  [LOAD_SHOT_END] (state, { shot, taskTypeMap }) {
    shot.tasks.forEach((task) => {
      helpers.populateTask(task, shot)
    })
    shot.tasks = sortTasks(shot.tasks, taskTypeMap)
    state.shotMap[shot.id] = shot
  },

  [SHOT_CSV_FILE_SELECTED] (state, formData) {
    state.shotsCsvFormData = formData
  },
  [IMPORT_SHOTS_END] (state) {
    state.shotsCsvFormData = null
  },

  [LOAD_OPEN_PRODUCTIONS_END] (state, projects) {
    state.openProductions = projects
  },

  [EDIT_SHOT_END] (state, newShot) {
    const shot = state.shotMap[newShot.id]
    const sequence = state.sequences.find(
      (sequence) => sequence.id === newShot.parent_id
    )
    newShot.sequence_name = sequence.name

    if (shot) {
      Object.assign(shot, newShot)
    } else {
      cache.shots.push(newShot)
      cache.shots = sortShots(cache.shots)
      state.shotMap[newShot.id] = newShot

      const maxX = state.displayedShots.length
      const maxY = state.nbValidationColumns
      state.shotSelectionGrid = buildSelectionGrid(maxX, maxY)
    }
    state.editShot = {
      isLoading: false,
      isError: false
    }
    cache.shotIndex = buildShotIndex(cache.shots)
    state.shotCreated = newShot.name

    if (state.shotSearchText) {
      helpers.setListStats(state, cache.result)
    } else {
      helpers.setListStats(state, cache.shots)
    }

    if (newShot.data.fps) state.isFps = true
    if (newShot.nb_frames) state.isFrames = true
    if (newShot.data.frame_in) state.isFrameIn = true
    if (newShot.data.frame_out) state.isFrameOut = true
    if (shot.description && !state.isShotDescription) {
      state.isShotDescription = true
    }
  },

  [EDIT_SEQUENCE_END] (state, newSequence) {
    const sequence = state.sequenceMap[newSequence.id]
    if (sequence) {
      Object.assign(sequence, newSequence)
    }
    state.sequenceIndex = buildSequenceIndex(state.sequences)
  },

  [EDIT_EPISODE_END] (state, newEpisode) {
    const episode = state.episodeMap[newEpisode.id]
    if (episode) {
      Object.assign(episode, newEpisode)
    }
    state.episodeIndex = buildEpisodeIndex(state.episodes)
  },

  [RESTORE_SHOT_END] (state, shotToRestore) {
    const shot = state.shotMap[shotToRestore.id]
    shot.canceled = false
    cache.shotIndex = buildShotIndex(cache.shots)
  },

  [NEW_TASK_COMMENT_END] (state, { comment, taskId }) {},

  [SET_SHOT_SEARCH] (state, payload) {
    const sorting = state.shotSorting
    payload.sorting = sorting
    helpers.buildResult(state, payload)
  },

  [SET_SEQUENCE_SEARCH] (state, { sequenceSearch, production }) {
    const keywords = getKeyWords(sequenceSearch)
    const result =
      indexSearch(state.sequenceIndex, keywords) || state.sequences

    state.searchSequenceFilters = getFilters({
      entryIndex: cache.shotIndex,
      assetTypes: [],
      taskTypes: [],
      taskStatuses: [],
      descriptors:
        production.descriptors.filter(d => d.entity_type === 'Shot'),
      persons: [],
      query: sequenceSearch
    })
    state.displayedSequences = result.slice(0, PAGE_SIZE * 2)
    state.displayedSequencesLength = result.length
    state.sequenceSearchText = sequenceSearch
  },

  [SET_EPISODE_SEARCH] (state, episodeSearch) {
    const keywords = getKeyWords(episodeSearch)
    const result =
      indexSearch(state.episodeIndex, keywords) || state.episodes

    state.displayedEpisodes = result.slice(0, PAGE_SIZE)
    state.displayedEpisodesLength = result.length
    state.episodeSearchText = episodeSearch
  },

  [NEW_SHOT_END] (state, shot) {
    const sequence = state.sequenceMap[shot.parent_id]
    const episode = state.episodeMap[sequence.parent_id]
    shot.production_id = shot.project_id
    shot.sequence_name = sequence.name
    shot.sequence_id = sequence.id
    shot.episode_name = episode ? episode.name : null
    shot.episode_id = episode ? episode.id : null
    shot.preview_file_id = ''

    shot.tasks = []
    shot.validations = {}
    shot.data = {}

    cache.shots.push(shot)
    cache.shots = sortShots(cache.shots)
    state.displayedShots = cache.shots.slice(0, PAGE_SIZE)
    helpers.setListStats(state, cache.shots)
    state.shotFilledColumns = getFilledColumns(state.displayedShots)
    state.shotMap[shot.id] = shot
    cache.shotIndex = buildShotIndex(cache.shots)

    const maxX = state.displayedShots.length
    const maxY = state.nbValidationColumns
    state.shotSelectionGrid = buildSelectionGrid(maxX, maxY)

    if (shot.data.fps) state.isFps = true
    if (shot.nb_frames) state.isFrames = true
    if (shot.data.frame_in) state.isFrameIn = true
    if (shot.data.frame_out) state.isFrameOut = true
  },

  [NEW_SEQUENCE_END] (state, sequence) {
    if (sequence.parent_id) {
      const episode = state.episodeMap[sequence.parent_id]
      sequence.episode_id = episode.id
      sequence.episode_name = episode.name
    }
    state.sequences.push(sequence)
    state.sequences = sortSequences(state.sequences)
    state.sequenceMap[sequence.id] = sequence
    state.sequenceIndex = buildSequenceIndex(state.sequences)
  },

  [NEW_EPISODE_END] (state, episode) {
    state.episodes.push(episode)
    state.episodes = sortByName(state.episodes)
    state.displayedEpisodes = state.episodes
    state.episodeMap[episode.id] = episode
  },

  [CREATE_TASKS_END] (state, tasks) {
    tasks.forEach((task) => {
      if (task) {
        const shot = state.shotMap[task.entity_id]
        if (shot) {
          helpers.populateTask(task, shot)
          const validations = { ...shot.validations }
          Vue.set(validations, task.task_type_id, task.id)
          delete shot.validations
          Vue.set(shot, 'validations', validations)
          shot.tasks.push(task.id)
        }
      }
    })
  },

  [DISPLAY_MORE_SHOTS] (state, {
    taskTypeMap,
    taskStatusMap,
    taskMap,
    production
  }) {
    const shots = cache.result
    const newLength = state.displayedShots.length + PAGE_SIZE
    if (newLength < shots.length + PAGE_SIZE) {
      state.displayedShots = shots.slice(
        0,
        state.displayedShots.length + PAGE_SIZE
      )
      state.shotFilledColumns = getFilledColumns(state.displayedShots)

      const previousX = state.displayedShots.length - PAGE_SIZE
      const maxX = state.displayedShots.length
      const maxY = state.nbValidationColumns
      if (previousX >= 0) {
        state.shotSelectionGrid = appendSelectionGrid(
          state.shotSelectionGrid, previousX, maxX, maxY
        )
      }
    }
  },

  [DISPLAY_MORE_SEQUENCES] (state, tasks) {
    let sequences = state.sequences
    if (state.sequenceSearchText.length > 0) {
      const keywords = getKeyWords(state.sequenceSearchText)
      sequences = indexSearch(state.sequenceIndex, keywords)
    }
    state.displayedSequences = sequences.slice(
      0,
      state.displayedSequences.length + PAGE_SIZE
    )
  },

  [DISPLAY_MORE_EPISODES] (state, tasks) {
    let episodes = state.episodes
    if (state.episodeSearchText.length > 0) {
      const keywords = getKeyWords(state.episodeSearchText)
      episodes = indexSearch(state.episodeIndex, keywords)
    }
    state.displayedEpisodes = episodes.slice(
      0,
      state.displayedEpisodes.length + PAGE_SIZE
    )
  },

  [SET_CURRENT_PRODUCTION] (state, production) {
    state.shotSearchText = ''
    state.sequenceSearchText = ''
  },

  [CLEAR_EPISODES] (state) {
    state.episodes = []
    state.currentEpisode = null
  },

  [SET_PREVIEW] (state, { entityId, taskId, previewId, taskMap }) {
    const shot = state.shotMap[entityId]
    if (shot) {
      shot.preview_file_id = previewId
      shot.tasks.forEach((taskId) => {
        const task = taskMap[taskId]
        if (task) task.entity.preview_file_id = previewId
      })
    }
  },

  [SET_SHOT_LIST_SCROLL_POSITION] (state, scrollPosition) {
    state.shotListScrollPosition = scrollPosition
  },

  [SET_SEQUENCE_LIST_SCROLL_POSITION] (state, scrollPosition) {
    state.sequenceListScrollPosition = scrollPosition
  },

  [SET_EPISODE_LIST_SCROLL_POSITION] (state, scrollPosition) {
    state.episodeListScrollPosition = scrollPosition
  },

  [REMOVE_SELECTED_TASK] (state, validationInfo) {
    if (state.shotSelectionGrid[0] &&
        state.shotSelectionGrid[validationInfo.x]) {
      state.shotSelectionGrid[validationInfo.x][validationInfo.y] = false
    }
  },

  [ADD_SELECTED_TASK] (state, validationInfo) {
    if (state.shotSelectionGrid[0] &&
        state.shotSelectionGrid[validationInfo.x]) {
      state.shotSelectionGrid[validationInfo.x][validationInfo.y] = true
    }
  },

  [CLEAR_SELECTED_TASKS] (state, validationInfo) {
    const tmpGrid = JSON.parse(JSON.stringify(state.shotSelectionGrid))
    state.shotSelectionGrid = clearSelectionGrid(tmpGrid)
  },

  [NEW_TASK_END] (state, task) {
    const shot = state.shotMap[task.entity_id]
    if (shot && task) {
      task = helpers.populateTask(task, shot)

      shot.tasks.push(task)
      Vue.set(shot.validations, task.task_type_id, task.id)
    }
  },

  [DELETE_TASK_END] (state, task) {
    const shot = state.displayedShots.find(
      (shot) => shot.id === task.entity_id
    )
    if (shot) {
      const validations = JSON.parse(JSON.stringify(shot.validations))
      delete validations[task.task_type_id]
      delete shot.validations
      Vue.set(shot, 'validations', validations)

      const taskIndex = shot.tasks.findIndex(
        (shotTaskId) => shotTaskId === task.id
      )
      shot.tasks.splice(taskIndex, 1)
    }
  },

  [ADD_SELECTED_TASKS] (state, selection) {
    const tmpGrid = JSON.parse(JSON.stringify(state.shotSelectionGrid))
    selection.forEach((validationInfo) => {
      if (tmpGrid[0] && tmpGrid[validationInfo.x]) {
        tmpGrid[validationInfo.x][validationInfo.y] = true
      }
    })
    state.shotSelectionGrid = tmpGrid
  },

  [SET_CURRENT_EPISODE] (state, episodeId) {
    if (episodeId) {
      if (episodeId === 'main') {
        state.currentEpisode = { id: 'main' }
      } else if (episodeId === 'all') {
        state.currentEpisode = { id: 'all' }
      } else {
        state.currentEpisode = state.episodeMap[episodeId]
      }
    }
  },

  [SET_EPISODE_STATS] (state, { episodeStats, taskTypeMap }) {
    const validationColumnsMap = {}
    if (episodeStats.all) {
      Object.keys(episodeStats.all).forEach((entryId) => {
        if (entryId !== 'all' && !episodeStats.all[entryId].name) {
          validationColumnsMap[entryId] = true
        }
      })
    }
    state.episodeStats = episodeStats
    const validationColumns = Object.keys(validationColumnsMap)
    state.episodeValidationColumns = sortValidationColumns(
      validationColumns, taskTypeMap
    )
  },

  [COMPUTE_SEQUENCE_STATS] (state, { taskMap, taskStatusMap }) {
    let shots = cache.shots
    if (state.searchSequenceFilters.length > 0) {
      shots = applyFilters(cache.shots, state.searchSequenceFilters, {})
    }
    state.sequenceStats = computeStats(
      shots,
      'sequence_id',
      taskStatusMap,
      taskMap
    )
  },

  [COMPUTE_EPISODE_STATS] (state, { taskMap, taskStatusMap }) {
    state.episodeStats = computeStats(
      cache.shots,
      'episode_id',
      taskStatusMap,
      taskMap
    )
  },

  [ADD_EPISODE] (state, episode) {
    state.episodes.push(episode)
    const sortedEpisodes = sortByName(state.episodes)
    state.episodeMap[episode.id] = episode
    state.episodes = sortedEpisodes
    state.displayedEpisodes.push(episode)
    state.displayedEpisodes = sortByName(state.displayedEpisodes)
    state.episodeIndex = buildEpisodeIndex(sortedEpisodes)
    state.displayedEpisodesLength = sortedEpisodes.length
  },

  [UPDATE_EPISODE] (state, episode) {
    Object.assign(state.episodeMap[episode.id], episode)
    state.episodeIndex = buildSequenceIndex(state.episodes)
  },

  [REMOVE_EPISODE] (state, episode) {
    delete state.episodeMap[episode.id]
    state.episodes = removeModelFromList(state.episodes, episode)
    state.displayedEpisodes =
      removeModelFromList(state.displayedEpisodes, episode)
    state.episodeIndex = buildEpisodeIndex(state.episodes)
  },

  [ADD_SEQUENCE] (state, sequence) {
    state.sequences.push(sequence)
    const sortedSequences = sortSequences(state.sequences)
    state.sequenceMap[sequence.id] = sequence
    if (sequence.parent_id) {
      const episode = state.episodeMap[sequence.parent_id]
      if (episode) {
        Object.assign(sequence, {
          episode_id: episode.id,
          episode_name: episode.name
        })
      }
    }
    state.sequences = sortedSequences
    state.displayedSequences.push(sequence)
    state.displayedSequences = sortSequences(state.displayedSequences)
    state.sequenceIndex = buildSequenceIndex(sortedSequences)
    state.displayedSequencesLength = sortedSequences.length
  },

  [UPDATE_SEQUENCE] (state, sequence) {
    Object.assign(state.sequenceMap[sequence.id], sequence)
    state.sequenceIndex = buildSequenceIndex(state.sequences)
  },

  [REMOVE_SEQUENCE] (state, sequence) {
    delete state.sequenceMap[sequence.id]
    state.sequences = removeModelFromList(state.sequences, sequence)
    state.displayedSequences =
      removeModelFromList(state.displayedSequences, sequence)
    state.sequenceIndex = buildSequenceIndex(state.sequences)
  },

  [ADD_SHOT] (state, {
    taskTypeMap,
    taskMap,
    personMap,
    production,
    shot
  }) {
    const taskIds = []
    const validations = {}
    let timeSpent = 0
    shot.project_name = production.name
    shot.production_id = production.id
    shot.tasks.forEach((task) => {
      helpers.populateTask(task, shot, production)
      timeSpent += task.duration
      task.episode_id = shot.episode_id

      taskMap[task.id] = task
      validations[task.task_type_id] = task.id
      taskIds.push(task.id)

      if (task.assignees.length > 1) {
        task.assignees = task.assignees.sort((a, b) => {
          return personMap[a].name.localeCompare(personMap[b])
        })
      }
    })
    shot.tasks = taskIds
    shot.validations = validations
    shot.timeSpent = timeSpent

    cache.shots.push(shot)
    cache.shots = sortShots(cache.shots)
    state.shotMap[shot.id] = shot

    state.displayedShots.push(shot)
    state.displayedShots = sortShots(state.displayedShots)
    state.displayedShotsLength = cache.shots.length
    state.shotFilledColumns = getFilledColumns(state.displayedShots)

    const maxX = state.displayedShots.length
    const maxY = state.nbValidationColumns
    state.shotSelectionGrid = buildSelectionGrid(maxX, maxY)
    state.shotMap[shot.id] = shot
  },

  [UPDATE_SHOT] (state, shot) {
    Object.assign(state.shotMap[shot.id], shot)
    cache.shotIndex = buildShotIndex(cache.shots)
  },

  [REMOVE_SHOT] (state, shotToDelete) {
    cache.shots = removeModelFromList(cache.shots, shotToDelete)
    state.displayedShots =
      removeModelFromList(state.displayedShots, shotToDelete)
    delete state.shotMap[shotToDelete.id]
    if (shotToDelete.timeSpent) {
      state.displayedShotsTimeSpent -= shotToDelete.timeSpent
    }
    if (shotToDelete.nb_frames) {
      state.displayedShotsFrames -= shotToDelete.nb_frames
    }
  },

  [CANCEL_SHOT] (state, shot) {
    shot.canceled = true
  },

  [CHANGE_SHOT_SORT] (state, {
    taskStatusMap, taskTypeMap, taskMap, production, sorting, persons
  }) {
    const shotSearch = state.shotSearchText
    state.shotSorting = sorting
    helpers.buildResult(state, {
      persons,
      production,
      sorting,
      shotSearch,
      taskStatusMap,
      taskTypeMap,
      taskMap
    })
  },

  [RESET_ALL] (state) {
    Object.assign(state, { ...initialState })

    cache.shots = []
    cache.result = []
    cache.shotIndex = {}
  }
}

export default {
  state,
  getters,
  actions,
  mutations,
  cache
}
