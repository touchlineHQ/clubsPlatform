import { useRef } from 'react';
import { Box, Center, Paper, Stack, Text } from '@mantine/core';
import { IconFileUpload } from '@tabler/icons-react';
import { clubDesign } from '../../theme';

interface FileDropzoneProps {
  /** Called with the chosen file, whether it was dropped or browsed for. */
  onFile: (file: File) => void;
  /** Line under the prompt; defaults to the accepted spreadsheet formats. */
  hint?: string;
}

/**
 * Click-or-drop picker for a single spreadsheet.
 *
 * Shared by the player import and the status report, which take the same FA
 * Club Player Report and differ only in what they do with it.
 */
export function FileDropzone({ onFile, hint }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Paper
      withBorder
      radius="md"
      p="xl"
      style={{
        borderStyle: 'dashed',
        cursor: 'pointer',
        textAlign: 'center',
        background: clubDesign.color.n1,
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onDrop={e => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      onDragOver={e => e.preventDefault()}
      onClick={() => inputRef.current?.click()}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--mantine-primary-color-filled)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '';
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      <Center>
        <Stack align="center" gap="xs">
          <Box
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: 'var(--mantine-primary-color-light)',
              color: 'var(--mantine-primary-color-filled)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconFileUpload size={28} />
          </Box>
          <Text fw={700} ff={clubDesign.font.heading}>Drop a file here or click to browse</Text>
          <Text size="sm" c="dimmed">
            {hint ?? 'Accepts .csv, .xlsx, .xls (FA Club Player Report)'}
          </Text>
        </Stack>
      </Center>
    </Paper>
  );
}
