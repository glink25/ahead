import { useEffect } from 'react'
import { toast, Toaster } from 'sonner'
import { Check, X, CircleAlert, LoaderCircle } from 'lucide-react'
import { useFeedStore } from '../stores/feed'

export function UndoToast() {
  const operation = useFeedStore((s) => s.undoOperation)
  useEffect(() => {
    if (!operation) return
    const id = 'undo-' + operation.id
    const expire = () => useFeedStore.getState().expireUndo(operation.id)
    toast('已更新', {
      id,
      duration: 4500,
      action: {
        label: '撤销',
        onClick: () => {
          void useFeedStore
            .getState()
            .undo(operation.id)
            .catch(() => toast.error('撤销失败，请检查浏览器存储权限后重试'))
        },
      },
      onDismiss: expire,
      onAutoClose: expire,
    })
    return () => {
      toast.dismiss(id)
    }
  }, [operation])
  return (
    <Toaster
      position="bottom-center"
      closeButton
      icons={{
        success: <Check />,
        error: <CircleAlert />,
        warning: <CircleAlert />,
        info: <CircleAlert />,
        loading: <LoaderCircle />,
        close: <X />,
      }}
      toastOptions={{
        style: {
          background: 'var(--surface)',
          color: 'var(--ink)',
          borderColor: 'var(--line)',
        },
        closeButtonAriaLabel: '关闭提示',
      }}
    />
  )
}
