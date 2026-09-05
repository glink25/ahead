import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
import { toast, Toaster } from 'sonner'
import { Check, X, CircleAlert, LoaderCircle } from 'lucide-react'
import { useFeedStore } from '../stores/feed'

export function UndoToast() {
  const { t, i18n } = useTranslation()

  const operation = useFeedStore((s) => s.undoOperation)
  useEffect(() => {
    if (!operation) return
    const id = 'undo-' + operation.id
    const expire = () => useFeedStore.getState().expireUndo(operation.id)
    toast(t('messages.updated'), {
      id,
      duration: 4500,
      action: {
        label: t('messages.undo'),
        onClick: () => {
          void useFeedStore
            .getState()
            .undo(operation.id)
            .catch(() => toast.error(t('messages.could_not_undo_check_browser_storage_permissions_and_retry')))
        },
      },
      onDismiss: expire,
      onAutoClose: expire,
    })
    return () => {
      toast.dismiss(id)
    }
  }, [operation, t, i18n.resolvedLanguage])
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
        closeButtonAriaLabel: t('messages.dismiss_notification'),
      }}
    />
  )
}
