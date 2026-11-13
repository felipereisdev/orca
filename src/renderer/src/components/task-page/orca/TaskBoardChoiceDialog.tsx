import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useTranslate } from '@/i18n/use-translate'

export type TaskBoardChoiceOption = { id: string; label: string }

type Props = {
  open: boolean
  title: string
  description: string
  options: readonly TaskBoardChoiceOption[]
  pending: boolean
  error: string | null
  onChoose: (id: string) => void
  onClose: () => void
}

/** Asks which provider status a dropped card should take when several map to the column. */
export function TaskBoardChoiceDialog({
  open,
  title,
  description,
  options,
  pending,
  error,
  onChoose,
  onClose
}: Props): React.JSX.Element {
  const t = useTranslate()
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) {
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          {options.map((option) => (
            <Button
              key={option.id}
              variant="secondary"
              disabled={pending}
              onClick={() => onChoose(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t('taskBoard.cancel', 'Cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
