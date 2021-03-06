import React, { useState, useEffect } from 'react'
import TxBrowser from './tx-browser/tx-browser'
import StepManager from './step-manager/step-manager'
import VmDebugger from './vm-debugger/vm-debugger'
import VmDebuggerHead from './vm-debugger/vm-debugger-head'
import remixDebug, { TransactionDebugger as Debugger } from '@remix-project/remix-debug'
/* eslint-disable-next-line */
import globalRegistry from '../../../../../apps/remix-ide/src/global/registry'
import './debugger-ui.css'

export const DebuggerUI = ({ debuggerModule }) => {
  const init = remixDebug.init
  const [state, setState] = useState({
    isActive: false,
    statusMessage: '',
    debugger: null,
    currentReceipt: {
      contractAddress: null,
      to: null
    },
    blockNumber: null,
    txNumber: '',
    debugging: false,
    opt: {
      debugWithGeneratedSources: false
    }
  })

  useEffect(() => {
    return unLoad()
  }, [])

  useEffect(() => {
    debug(debuggerModule.debugHash)
  }, [debuggerModule.debugHash])

  useEffect(() => {
    getTrace(debuggerModule.getTraceHash)
  }, [debuggerModule.getTraceHash])

  useEffect(() => {
    if (debuggerModule.removeHighlights) deleteHighlights()
  }, [debuggerModule.removeHighlights])

  useEffect(() => {
    const setEditor = () => {
      const editor = globalRegistry.get('editor').api

      editor.event.register('breakpointCleared', (fileName, row) => {
        if (state.debugger) state.debugger.breakPointManager.remove({fileName: fileName, row: row})
      })
  
      editor.event.register('breakpointAdded', (fileName, row) => {
        if (state.debugger) {
          state.debugger.breakPointManager.add({fileName: fileName, row: row})
        }
      })
  
      editor.event.register('contentChanged', () => {
        unLoad()
      })
    }

    setEditor()
  }, [state.debugger])

  const fetchContractAndCompile = (address, receipt) => {
    const target = (address && remixDebug.traceHelper.isContractCreation(address)) ? receipt.contractAddress : address

    return debuggerModule.call('fetchAndCompile', 'resolve', target || receipt.contractAddress || receipt.to, '.debug', debuggerModule.blockchain.web3())
  }

  const listenToEvents = (debuggerInstance, currentReceipt) => {
    if (!debuggerInstance) return

    debuggerInstance.event.register('debuggerStatus', async (isActive) => {
      await debuggerModule.call('editor', 'discardHighlight')
      setState( prevState => {
        return { ...prevState, isActive }
      })
    })

    debuggerInstance.event.register('newSourceLocation', async (lineColumnPos, rawLocation, generatedSources) => {
      if (!lineColumnPos) return
      const contracts = await fetchContractAndCompile(
        currentReceipt.contractAddress || currentReceipt.to,
        currentReceipt)

      if (contracts) {
        let path = contracts.getSourceName(rawLocation.file)
        if (!path) {
          // check in generated sources
          for (const source of generatedSources) {
            if (source.id === rawLocation.file) {
              path = `browser/.debugger/generated-sources/${source.name}`
              let content
              try {
                content = await debuggerModule.call('fileManager', 'getFile', path, source.contents)
              } catch (e) {
                console.log('unable to fetch generated sources, the file probably doesn\'t exist yet', e)
              }
              if (content !== source.contents) {
                await debuggerModule.call('fileManager', 'setFile', path, source.contents)
              }
              break
            }
          }
        }
        if (path) {
          await debuggerModule.call('editor', 'discardHighlight')
          await debuggerModule.call('editor', 'highlight', lineColumnPos, path)
        }
      }
    })

    debuggerInstance.event.register('debuggerUnloaded', () => unLoad())
  }

  const requestDebug = (blockNumber, txNumber, tx) => {
    startDebugging(blockNumber, txNumber, tx)
  }

  const unloadRequested = (blockNumber, txIndex, tx) => {
    unLoad()
  }

  const isDebuggerActive = () => {
    return state.isActive
  }

  const getDebugWeb3 = (): Promise<any> => {
    return new Promise((resolve, reject) => {
      debuggerModule.blockchain.detectNetwork((error, network) => {
        let web3
        if (error || !network) {
          web3 = init.web3DebugNode(debuggerModule.blockchain.web3())
        } else {
          const webDebugNode = init.web3DebugNode(network.name)
          web3 = !webDebugNode ? debuggerModule.blockchain.web3() : webDebugNode
        }
        init.extendWeb3(web3)
        resolve(web3)
      })
    })
  }

  const unLoad = () => {
    if (state.debugger) state.debugger.unload()
    setState(prevState => {
      return {
        ...prevState,
        isActive: false,
        statusMessage: '',
        debugger: null,
        currentReceipt: {
          contractAddress: null,
          to: null
        },
        blockNumber: null,
        ready: {
          vmDebugger: false,
          vmDebuggerHead: false
        },
        debugging: false
      }
    })
  }

  const startDebugging = async (blockNumber, txNumber, tx) => {
    if (state.debugger) unLoad()
    if (!txNumber) return
    const web3 = await getDebugWeb3()
    const currentReceipt = await web3.eth.getTransactionReceipt(txNumber)
    const debuggerInstance = new Debugger({
      web3,
      offsetToLineColumnConverter: globalRegistry.get('offsettolinecolumnconverter').api,
      compilationResult: async (address) => {
        try {
          return await fetchContractAndCompile(address, currentReceipt)
        } catch (e) {
          console.error(e)
        }
        return null
      },
      debugWithGeneratedSources: state.opt.debugWithGeneratedSources
    })
    debuggerInstance.debug(blockNumber, txNumber, tx, () => {
      listenToEvents(debuggerInstance, currentReceipt)
      setState(prevState => {
        return {
          ...prevState,
          blockNumber,
          txNumber,
          debugging: true,
          currentReceipt,
          debugger: debuggerInstance
        }
      })
    }).catch((error) => {
      // toaster(error, null, null)
      unLoad()
    })
}

const debug = (txHash) => {
  startDebugging(null, txHash, null)
}

const getTrace = (hash) => {
  if (!hash) return
  return new Promise(async (resolve, reject) => { /* eslint-disable-line */
    const web3 = await getDebugWeb3()
    const currentReceipt = await web3.eth.getTransactionReceipt(hash)
    const debug = new Debugger({
      web3,
      offsetToLineColumnConverter: globalRegistry.get('offsettolinecolumnconverter').api,
      compilationResult: async (address) => {
        try {
          return await fetchContractAndCompile(address, currentReceipt)
        } catch (e) {
          console.error(e)
        }
        return null
      },
      debugWithGeneratedSources: false
    })

    setState(prevState => {
      return { ...prevState, currentReceipt }
    })

    debug.debugger.traceManager.traceRetriever.getTrace(hash, (error, trace) => {
      if (error) return reject(error)
      resolve(trace)
    })
  })
}

const deleteHighlights = async () => {
  await debuggerModule.call('editor', 'discardHighlight')
}

const stepManager = {
  jumpTo: state.debugger && state.debugger.step_manager ? state.debugger.step_manager.jumpTo.bind(state.debugger.step_manager) : null,
  stepOverBack: state.debugger && state.debugger.step_manager ? state.debugger.step_manager.stepOverBack.bind(state.debugger.step_manager) : null,
  stepIntoBack: state.debugger && state.debugger.step_manager ? state.debugger.step_manager.stepIntoBack.bind(state.debugger.step_manager) : null,
  stepIntoForward: state.debugger && state.debugger.step_manager ? state.debugger.step_manager.stepIntoForward.bind(state.debugger.step_manager) : null,
  stepOverForward: state.debugger && state.debugger.step_manager ? state.debugger.step_manager.stepOverForward.bind(state.debugger.step_manager) : null,
  jumpOut: state.debugger && state.debugger.step_manager ? state.debugger.step_manager.jumpOut.bind(state.debugger.step_manager) : null,
  jumpPreviousBreakpoint: state.debugger && state.debugger.step_manager ? state.debugger.step_manager.jumpPreviousBreakpoint.bind(state.debugger.step_manager) : null,
  jumpNextBreakpoint: state.debugger && state.debugger.step_manager ? state.debugger.step_manager.jumpNextBreakpoint.bind(state.debugger.step_manager) : null,
  jumpToException: state.debugger && state.debugger.step_manager ? state.debugger.step_manager.jumpToException.bind(state.debugger.step_manager) : null,
  traceLength: state.debugger && state.debugger.step_manager ? state.debugger.step_manager.traceLength : null,
  registerEvent: state.debugger && state.debugger.step_manager ? state.debugger.step_manager.event.register.bind(state.debugger.step_manager.event) : null,
}
const vmDebugger = {
  registerEvent: state.debugger && state.debugger.vmDebuggerLogic ? state.debugger.vmDebuggerLogic.event.register.bind(state.debugger.vmDebuggerLogic.event) : null,
  triggerEvent: state.debugger && state.debugger.vmDebuggerLogic ? state.debugger.vmDebuggerLogic.event.trigger.bind(state.debugger.vmDebuggerLogic.event) : null
}

  return (
      <div>
        <div className="px-2">
          <div className="mt-3">
            <p className="mt-2 debuggerLabel">Debugger Configuration</p>
            <div className="mt-2 debuggerConfig custom-control custom-checkbox">
              <input className="custom-control-input" id="debugGeneratedSourcesInput" onChange={({ target: { checked } }) => {
                setState(prevState => {
                  return { ...prevState, opt: { debugWithGeneratedSources: checked }}
                })
              }} type="checkbox" title="Debug with generated sources" />
              <label data-id="debugGeneratedSourcesLabel" className="form-check-label custom-control-label" htmlFor="debugGeneratedSourcesInput">Use generated sources (from Solidity v0.7.2)</label>
            </div>
          </div>
          <TxBrowser requestDebug={ requestDebug } unloadRequested={ unloadRequested } transactionNumber={ state.txNumber } debugging={ state.debugging } />
  { state.debugging && <StepManager stepManager={ stepManager } /> }
  { state.debugging && <VmDebuggerHead vmDebugger={ vmDebugger } /> }
        </div>
  { state.debugging && <div className="statusMessage">{ state.statusMessage }</div> }
  { state.debugging && <VmDebugger vmDebugger={ vmDebugger } /> }
      </div>
  )
}

export default DebuggerUI
